import { config } from 'dotenv'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { AisNavState, PortStop, SnapshotRequest, SnapshotResponse } from '../shared/types.ts'
import { estimatedPosition, findLeg, forecastPath, haversineKm, nearPort, routePath } from '../shared/geo.ts'
import { isStoppedNav, isUnderwayNav, navStateFromAis, resolveAisDestination } from '../shared/ais.ts'
import { watchMmsi, aisConfigured, waitForLive, aisError, lastKnownPosition, actualDeparture, voyageOf, aisTrail } from './ais.ts'
import { fetchVesselFinder, vesselFinderConfigured, vesselFinderError } from './vesselfinder.ts'
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
import { fetchWeather } from './weather.ts'
import { getStoredTrip, parseTrip, saveStoredTrip } from './trip-store.ts'

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

app.get('/api/health', (c) => c.json({ ok: true }))

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
    vesselFinderConfigured: vesselFinderConfigured(),
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
  return c.json({ trip })
})

app.post('/api/snapshot', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SnapshotRequest | null
  if (!body?.mmsi || !body.shipName || !body.stops?.length) {
    return c.json({ error: 'invalid_request' }, 400)
  }

  watchMmsi(body.mmsi, body.stops)
  const now = new Date()
  const leg = findLeg(body.stops, now)
  if (!leg) return c.json({ error: 'no_route' }, 400)

  const weatherStop = leg.previous && !leg.atPort ? leg.previous : leg.next
  const weatherPromise = fetchWeather(weatherStop.lat, weatherStop.lng, now).catch(() => null)
  const streamFix = aisConfigured() ? await waitForLive(body.mmsi, 4000) : lastKnownPosition(body.mmsi)
  const finderFix = vesselFinderConfigured()
    ? await fetchVesselFinder(body.mmsi, body.imo).catch(() => null)
    : null

  const liveMs = 45 * 60 * 1000
  const known = streamFix ?? lastKnownPosition(body.mmsi)
  const aisPoint = newerStamp(known, finderFix)
  const aisAge = aisPoint ? now.getTime() - aisPoint.ts : Number.POSITIVE_INFINITY
  const aisLive = Boolean(aisPoint) && aisAge < liveMs
  const guessed = estimatedPosition(body.stops, now, null)
  if (!guessed) return c.json({ error: 'no_route' }, 400)

  const streamError = aisError()
  const finderError = vesselFinderError(body.mmsi)
  const hasTracker = aisConfigured()
  const tracking = aisPoint
    ? aisLive
      ? 'live'
      : 'last-known'
    : !hasTracker
      ? 'no-key'
      : finderError || streamError
        ? 'ais-error'
        : 'estimated'

  const position = aisPoint
    ? { lat: aisPoint.lat, lng: aisPoint.lng, source: aisLive ? ('live' as const) : ('approx' as const) }
    : { ...guessed.point, source: 'approx' as const }

  const next = guessed.next
  const motionFix = known
  const nav = motionFix
    ? navStateFromAis(motionFix.navStatus, motionFix.sog)
    : aisPoint
      ? 'unknown'
      : guessed.atPort
        ? 'moored'
        : 'unknown'
  const berth = pickBerth(body.stops, aisPoint, leg, guessed.atPort, nav)
  const atPort = Boolean(berth)
  const shown = berth ?? next
  const berthIndex = berth ? body.stops.findIndex((stop) => stop.id === berth.id) : -1
  const following = berthIndex >= 0 ? (body.stops[berthIndex + 1] ?? null) : next
  const destination = following ?? shown
  const loc = (stop: { name: string; nameDe: string }) => (body.locale === 'de' ? stop.nameDe : stop.name)
  const streamVoyage = voyageOf(body.mmsi)
  const aisDestination = resolveAisDestination(
    streamVoyage?.destination ?? finderFix?.destination ?? null,
    body.stops,
    body.locale,
  )
  const voyage =
    aisDestination || streamVoyage?.eta
      ? { destination: aisDestination, eta: streamVoyage?.eta ?? null }
      : null
  const weather =
    (await weatherPromise) ??
    (await fetchWeather(position.lat, position.lng, now).catch(() => null))

  const lastStamp = aisPoint ?? known ?? finderFix
  const departStop = atPort ? shown : (leg.previous ?? null)
  const actualTs = departStop ? actualDeparture(body.mmsi, departStop.id) : null
  const track = aisTrail(body.mmsi)
  const lastAis = track[track.length - 1] ?? (known ? { lat: known.lat, lng: known.lng } : null)
  const forecast = forecastPath(lastAis, position, destination, atPort)
  const payload: SnapshotResponse = {
    position,
    tracking,
    seenAt: lastStamp ? new Date(lastStamp.ts).toISOString() : null,
    zone: finderFix?.zone ?? null,
    motion: motionFix
      ? {
          nav,
          sogKn: motionFix.sog ?? null,
          cog: motionFix.cog ?? null,
          heading: motionFix.heading ?? motionFix.cog ?? null,
        }
      : { nav, sogKn: null, cog: null, heading: null },
    voyage,
    nextPort: {
      name: loc(destination),
      arriveAt: destination.arriveAt,
      lat: destination.lat,
      lng: destination.lng,
      atPort,
      berthName: atPort ? loc(shown) : null,
      departAt: atPort ? shown.departAt : null,
    },
    weather,
    narrative: '',
    path: routePath(body.stops),
    track,
    forecast,
    fromPort: !atPort && leg.previous ? loc(leg.previous) : null,
    distanceKm: !atPort ? Math.round(haversineKm(position, destination)) : null,
    departure: departStop
      ? {
          portName: loc(departStop),
          planned: departStop.departAt,
          actual: actualTs ? new Date(actualTs).toISOString() : null,
        }
      : null,
  }
  return c.json(payload)
})

if (isProd && existsSync('dist/index.html')) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', async (c) => {
    const html = await readFile('dist/index.html', 'utf8')
    return c.html(html)
  })
}

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  const keyReady = expectedAccessKey().length > 0
  console.log(`Cruise Tracker API on http://0.0.0.0:${info.port}`)
  if (!keyReady) console.warn('APP_ACCESS_KEY is empty — login will fail until it is set.')
})

function newerStamp<T extends { ts: number }>(a: T | null, b: T | null): T | null {
  if (!a) return b
  if (!b) return a
  return a.ts >= b.ts ? a : b
}

function pickBerth(
  stops: PortStop[],
  liveFix: { lat: number; lng: number } | null,
  leg: { previous: PortStop | null; next: PortStop; atPort: boolean },
  scheduledAtPort: boolean,
  nav: AisNavState,
): PortStop | null {
  if (!liveFix) return scheduledAtPort ? leg.next : null
  const nearest =
    stops
      .map((stop) => ({ stop, km: haversineKm(liveFix, stop) }))
      .filter((item) => item.km <= 8)
      .sort((a, b) => a.km - b.km)[0]?.stop ?? null
  if (isStoppedNav(nav)) return nearest
  if (isUnderwayNav(nav)) return null
  if (leg.previous && nearPort(liveFix, leg.previous)) return leg.previous
  if (leg.atPort && nearPort(liveFix, leg.next)) return leg.next
  return nearest
}
