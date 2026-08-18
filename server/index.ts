import { config } from 'dotenv'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { SnapshotRequest } from '../shared/types.ts'
import { aisConfigured, aisError } from './ais.ts'
import { dataDockedStatus } from './datadocked.ts'
import {
  COOKIE_NAME,
  allowLoginAttempt,
  clearLoginAttempts,
  createSession,
  destroySession,
  expectedAccessKey,
  keysMatch,
  recordFailedLogin,
  sessionIsValid,
} from './auth.ts'
import { getStoredTrip, parseTrip, saveStoredTrip } from './trip-store.ts'
import { buildSnapshot } from './snapshot.ts'
import { listTimeline } from './timeline.ts'
import { pushPublicKey, removePushSub, savePushSub } from './push.ts'
import { startTripWatch } from './watch.ts'

config()

const isProd = process.env.NODE_ENV === 'production'
const port = Number(isProd ? (process.env.PORT ?? 3344) : (process.env.API_PORT ?? 3345))

const app = new Hono()

function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

function requestIsHttps(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (proto) return proto === 'https'
  if (request.headers.get('x-forwarded-ssl')?.toLowerCase() === 'on') return true
  const forwarded = request.headers.get('forwarded')
  if (forwarded && /proto\s*=\s*https/i.test(forwarded)) return true
  const origin = request.headers.get('origin') ?? request.headers.get('referer') ?? ''
  if (origin.startsWith('https:')) {
    try {
      const host = new URL(origin).hostname
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && !host.endsWith('.localhost')) {
        return true
      }
    } catch {
      /* ignore malformed origin */
    }
  }
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

function sessionCookieOptions(request: Request) {
  const secure = process.env.COOKIE_SECURE === 'true' || requestIsHttps(request)
  return {
    httpOnly: true,
    path: '/',
    // None+Secure is required for the installed PWA behind HTTPS; Lax is for local HTTP.
    sameSite: secure ? ('none' as const) : ('lax' as const),
    secure,
    maxAge: 60 * 60 * 24 * 14,
  }
}

function requireSession() {
  return async (
    c: { req: { raw: Request }; json: (data: unknown, status?: number) => Response },
    next: () => Promise<void>,
  ) => {
    const token = getCookie(c as never, COOKIE_NAME)
    if (!sessionIsValid(token)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  }
}

app.get('/api/health', (c) => c.json({ ok: true, sha: process.env.GIT_SHA ?? 'dev' }))

app.post('/api/auth/login', async (c) => {
  const expected = expectedAccessKey()
  if (!expected) {
    return c.json({ error: 'server_misconfigured' }, 500)
  }
  const ip = clientIp(c.req.raw.headers)
  if (!allowLoginAttempt(ip)) {
    return c.json({ error: 'too_many_attempts' }, 429)
  }
  const body = (await c.req.json().catch(() => ({}))) as { key?: string }
  if (!keysMatch(String(body.key ?? ''), expected)) {
    recordFailedLogin(ip)
    return c.json({ error: 'invalid_key' }, 401)
  }
  const token = createSession()
  clearLoginAttempts(ip)
  setCookie(c, COOKIE_NAME, token, sessionCookieOptions(c.req.raw))
  return c.json({ ok: true })
})

app.post('/api/auth/logout', (c) => {
  destroySession(getCookie(c, COOKIE_NAME))
  const opts = sessionCookieOptions(c.req.raw)
  deleteCookie(c, COOKIE_NAME, { path: opts.path, secure: opts.secure, sameSite: opts.sameSite })
  return c.json({ ok: true })
})

app.get('/api/auth/session', (c) => {
  const token = getCookie(c, COOKIE_NAME)
  if (!sessionIsValid(token)) return c.json({ ok: false }, 401)
  return c.json({ ok: true })
})

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health') {
    return next()
  }
  return requireSession()(c, next)
})

app.get('/api/status', (c) => {
  return c.json({
    aisConfigured: aisConfigured(),
    dataDocked: dataDockedStatus(),
    llmConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    aisError: aisError(),
  })
})

app.get('/api/trip', (c) => {
  return c.json({ trip: getStoredTrip() })
})

app.put('/api/trip', async (c) => {
  const trip = parseTrip(await c.req.json().catch(() => null))
  if (!trip) return c.json({ error: 'invalid_trip' }, 400)
  await saveStoredTrip(trip)
  startTripWatch()
  return c.json({ trip })
})

app.get('/api/timeline', (c) => {
  return c.json({ events: listTimeline() })
})

app.get('/api/push/key', (c) => {
  return c.json({ key: pushPublicKey() })
})

app.post('/api/push/subscribe', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  } | null
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: 'invalid_subscription' }, 400)
  }
  await savePushSub({ endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } })
  return c.json({ ok: true })
})

app.post('/api/push/unsubscribe', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { endpoint?: string } | null
  if (body?.endpoint) await removePushSub(body.endpoint)
  return c.json({ ok: true })
})

app.post('/api/snapshot', async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as SnapshotRequest | null
    const payload = await buildSnapshot(body as SnapshotRequest)
    if ('error' in payload) return c.json({ error: payload.error }, payload.status)
    return c.json(payload)
  } catch (error) {
    console.warn('snapshot failed:', error instanceof Error ? error.message : error)
    return c.json({ error: 'snapshot_failed' }, 500)
  }
})

if (isProd && existsSync('dist/index.html')) {
  app.use('*', async (c, next) => {
    const path = c.req.path
    if (
      path === '/' ||
      path === '/widget' ||
      path === '/index.html' ||
      path === '/sw.js' ||
      path === '/manifest.webmanifest'
    ) {
      c.header('Cache-Control', 'no-store')
    } else if (path.startsWith('/assets/')) {
      c.header('Cache-Control', 'public, max-age=31536000, immutable')
    }
    await next()
  })
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', async (c) => {
    c.header('Cache-Control', 'no-store')
    const html = await readFile('dist/index.html', 'utf8')
    return c.html(html)
  })
}

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  const keyReady = expectedAccessKey().length > 0
  console.log(`Cruise Tracker API on http://0.0.0.0:${info.port}`)
  if (!keyReady) console.warn('APP_ACCESS_KEY is empty — login will fail until it is set.')
  startTripWatch()
})
