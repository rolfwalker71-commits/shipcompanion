import { config } from 'dotenv'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { SnapshotRequest } from '../shared/types.ts'
import { aisConfigured, aisError } from './ais.ts'
import { dataDockedStatus, forceRefreshDataDocked, setIntervalHours, settingsPinConfigured } from './datadocked.ts'
import { tripShip } from '../shared/ships.ts'
import {
  COOKIE_NAME,
  allowLoginAttempt,
  clearLoginAttempts,
  createSession,
  destroySession,
  expectedAccessKey,
  expectedSettingsPin,
  loginRole,
  recordFailedLogin,
  sessionIsValid,
  sessionRole,
} from './auth.ts'
import { getStoredTrip, parseTrip, saveStoredTrip } from './trip-store.ts'
import { buildSnapshot } from './snapshot.ts'
import { addTimelineEvent, listTimeline } from './timeline.ts'
import { notifyFamily, pushPublicKey, removePushSub, savePushSub } from './push.ts'
import {
  archiveActiveRoute,
  clearManualFix,
  getActiveRoute,
  getArchiveById,
  getArchives,
  publicManualFix,
  saveManualFix,
} from './manual-position.ts'
import { startTripWatch } from './watch.ts'
import { deletePhoto, listPhotos, readPhoto, savePhoto } from './photos.ts'

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
  if (!expectedAccessKey() && !expectedSettingsPin()) {
    return c.json({ error: 'server_misconfigured' }, 500)
  }
  const ip = clientIp(c.req.raw.headers)
  if (!allowLoginAttempt(ip)) {
    return c.json({ error: 'too_many_attempts' }, 429)
  }
  const body = (await c.req.json().catch(() => ({}))) as { key?: string }
  const role = loginRole(String(body.key ?? ''))
  if (!role) {
    recordFailedLogin(ip)
    return c.json({ error: 'invalid_key' }, 401)
  }
  const token = createSession(role)
  clearLoginAttempts(ip)
  setCookie(c, COOKIE_NAME, token, sessionCookieOptions(c.req.raw))
  return c.json({ ok: true, role })
})

app.post('/api/auth/logout', (c) => {
  destroySession(getCookie(c, COOKIE_NAME))
  const opts = sessionCookieOptions(c.req.raw)
  deleteCookie(c, COOKIE_NAME, { path: opts.path, secure: opts.secure, sameSite: opts.sameSite })
  return c.json({ ok: true })
})

app.get('/api/auth/session', (c) => {
  const token = getCookie(c, COOKIE_NAME)
  const role = sessionRole(token)
  if (!role) return c.json({ ok: false }, 401)
  return c.json({ ok: true, role })
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
    pinConfigured: settingsPinConfigured(),
    llmConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    aisError: aisError(),
  })
})

app.get('/api/manual-position', (c) => {
  return c.json({ fix: publicManualFix() })
})

app.post('/api/manual-position', async (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const body = (await c.req.json().catch(() => null)) as {
    lat?: unknown
    lng?: unknown
    accuracyM?: unknown
    postedBy?: unknown
  } | null
  const result = saveManualFix(body ?? {})
  if (!result.ok) {
    if (result.error === 'too_soon') return c.json({ error: 'too_soon' }, 429)
    return c.json({ error: result.error }, 400)
  }
  const who = result.fix.postedBy
  const acc =
    result.fix.accuracyM != null ? ` (±${Math.round(result.fix.accuracyM)} m)` : ''
  await addTimelineEvent({
    kind: 'manual-position',
    titleDe: 'Position von Bord gemeldet',
    titleEn: 'Position reported from the ship',
    detailDe: who ? `Von ${who}${acc}` : acc ? `GPS${acc}` : undefined,
    detailEn: who ? `From ${who}${acc}` : acc ? `GPS${acc}` : undefined,
  })
  await notifyFamily(
    'Position von Bord gemeldet',
    who ? `${who} hat eine GPS-Position geschickt.` : 'Eine GPS-Position von Bord ist da.',
    '/',
    'cruise-manual-position',
  )
  return c.json({ fix: publicManualFix() })
})

app.delete('/api/manual-position', (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const cleared = clearManualFix()
  return c.json({ ok: true, cleared })
})

app.get('/api/manual-position/route', (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  return c.json({ points: getActiveRoute() })
})

app.get('/api/manual-position/archive', (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  return c.json({ archives: getArchives() })
})

app.post('/api/manual-position/archive', async (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null
  const result = archiveActiveRoute(body?.name)
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ archive: { id: result.archive.id, name: result.archive.name, createdAt: result.archive.createdAt, pointCount: result.archive.points.length } })
})

app.get('/api/manual-position/archive/:id', (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const archive = getArchiveById(c.req.param('id'))
  if (!archive) return c.json({ error: 'not_found' }, 404)
  return c.json({ archive })
})

app.post('/api/datadocked/interval', async (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const body = (await c.req.json().catch(() => null)) as { hours?: number } | null
  const hours = Number(body?.hours)
  if (!setIntervalHours(hours)) return c.json({ error: 'invalid_interval' }, 400)
  return c.json({ dataDocked: dataDockedStatus() })
})

app.post('/api/datadocked/fetch', async (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const trip = getStoredTrip()
  const ship = trip ? tripShip(trip) : undefined
  const result = await forceRefreshDataDocked(ship?.mmsi ?? '')
  if (!result.ok) {
    const http =
      result.error === 'no_credits'
        ? 429
        : result.error === 'fetch_failed' || result.error === 'no_position'
          ? 502
          : 400
    return c.json({ error: result.error, dataDocked: result.status }, http)
  }
  return c.json({
    ok: true,
    dataDocked: result.status,
    lastFixAt: new Date(result.fix.ts).toISOString(),
  })
})

app.get('/api/trip', (c) => {
  return c.json({ trip: getStoredTrip() })
})

app.put('/api/trip', async (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
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

app.get('/api/photos', async (c) => {
  const photos = await listPhotos()
  return c.json({ photos })
})

app.get('/api/photos/latest', async (c) => {
  const photos = await listPhotos()
  const latest = photos.at(-1)
  if (!latest) return c.body(null, 404)
  const bytes = await readPhoto(latest.id)
  if (!bytes) return c.body(null, 404)
  c.header('Content-Type', 'image/jpeg')
  c.header('Cache-Control', 'private, max-age=120')
  return c.body(new Uint8Array(bytes))
})

app.get('/api/photos/:id', async (c) => {
  const id = c.req.param('id')
  const bytes = await readPhoto(id)
  if (!bytes) return c.body(null, 404)
  c.header('Content-Type', 'image/jpeg')
  c.header('Cache-Control', 'private, max-age=120')
  return c.body(new Uint8Array(bytes))
})

app.post('/api/photos', async (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') return c.json({ error: 'forbidden' }, 403)
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.photo
  if (!(file instanceof File)) return c.json({ error: 'missing_photo' }, 400)
  const buf = Buffer.from(await file.arrayBuffer())
  const photo = await savePhoto(buf, {
    caption: body?.caption,
    postedBy: body?.postedBy,
  })
  if (!photo) return c.json({ error: 'photo_too_large' }, 413)
  return c.json({ photo })
})

app.delete('/api/photos/:id', async (c) => {
  if (sessionRole(getCookie(c, COOKIE_NAME)) !== 'admin') {
    return c.json({ error: 'forbidden' }, 403)
  }
  const ok = await deletePhoto(c.req.param('id'))
  if (!ok) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
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
  console.log(`Cruise Tracker API on http://0.0.0.0:${info.port}`)
  if (!expectedAccessKey()) console.warn('APP_ACCESS_KEY is empty — family login will fail until it is set.')
  if (!expectedSettingsPin()) console.warn('SETTINGS_PIN is empty — family login also has admin until it is set.')
  startTripWatch()
})
