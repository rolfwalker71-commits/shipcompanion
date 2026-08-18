import type { AisNavState, SnapshotRequest, SnapshotResponse } from '../shared/types.ts'
import { estimatedPosition, estimateUnderway, findLeg, forecastPath, haversineKm, nearPort, routePath } from '../shared/geo.ts'
import { isStoppedNav, isUnderwayNav, navStateFromAis, resolveAisDestination } from '../shared/ais.ts'
import { watchMmsi, aisConfigured, waitForLive, aisError, lastKnownPosition, lastAisPosition, actualDeparture, voyageOf, aisTrail } from './ais.ts'
import { fetchWeather } from './weather.ts'
import { narrate } from './narrate.ts'

export async function buildSnapshot(body: SnapshotRequest): Promise<SnapshotResponse | { error: string; status: 400 }> {
  if (!body?.mmsi || !body.shipName || !body.stops?.length) {
    return { error: 'invalid_request', status: 400 }
  }

  watchMmsi(body.mmsi, body.stops)
  const now = new Date()
  const leg = findLeg(body.stops, now)
  if (!leg) return { error: 'no_route', status: 400 }

  const weatherStop = leg.previous && !leg.atPort ? leg.previous : leg.next
  const weatherPromise = fetchWeather(weatherStop.lat, weatherStop.lng, now).catch(() => null)
  const streamFix = aisConfigured() ? await waitForLive(body.mmsi, 4000) : lastKnownPosition(body.mmsi)
  const known = lastAisPosition(body.mmsi) ?? streamFix ?? lastKnownPosition(body.mmsi)
  const liveMs = 45 * 60 * 1000
  const aisAge = known ? now.getTime() - known.ts : Number.POSITIVE_INFINITY
  const aisLive = Boolean(known) && aisAge < liveMs
  const guessed = estimatedPosition(body.stops, now, known)
  if (!guessed) return { error: 'no_route', status: 400 }

  const streamError = aisError()
  const hasTracker = aisConfigured()
  const estimate =
    !aisLive && known && !guessed.atPort
      ? estimateUnderway(
          {
            lat: known.lat,
            lng: known.lng,
            ts: known.ts,
            sogKn: known.sog,
            cog: known.cog ?? known.heading,
          },
          guessed.next,
          now,
          guessed.next.arriveAt,
        )
      : null

  const tracking = aisLive
    ? 'live'
    : estimate
      ? 'estimated'
      : known
        ? 'last-known'
        : !hasTracker
          ? 'no-key'
          : streamError
            ? 'ais-error'
            : 'estimated'

  const position = aisLive && known
    ? { lat: known.lat, lng: known.lng, source: 'live' as const }
    : estimate
      ? { lat: estimate.point.lat, lng: estimate.point.lng, source: 'approx' as const }
      : guessed.atPort
        ? { ...guessed.point, source: 'approx' as const }
        : known
          ? { lat: known.lat, lng: known.lng, source: 'approx' as const }
          : { ...guessed.point, source: 'approx' as const }

  const next = guessed.next
  const nav = estimate
    ? 'underway'
    : known
      ? navStateFromAis(known.navStatus, known.sog)
      : guessed.atPort
        ? 'moored'
        : 'unknown'
  const berth = estimate ? null : pickBerth(body.stops, known, leg, guessed.atPort, nav)
  const atPort = Boolean(berth)
  const shown = berth ?? next
  const berthIndex = berth ? body.stops.findIndex((stop) => stop.id === berth.id) : -1
  const following = berthIndex >= 0 ? (body.stops[berthIndex + 1] ?? null) : next
  const destination = following ?? shown
  const loc = (stop: { name: string; nameDe: string }) => (body.locale === 'de' ? stop.nameDe : stop.name)
  const streamVoyage = voyageOf(body.mmsi)
  const aisDestination = resolveAisDestination(streamVoyage?.destination ?? null, body.stops, body.locale)
  const voyageEta = streamVoyage?.eta ?? null
  const voyage =
    aisDestination || voyageEta ? { destination: aisDestination, eta: voyageEta } : null
  const weather =
    (await weatherPromise) ??
    (await fetchWeather(position.lat, position.lng, now).catch(() => null))

  const departStop = atPort ? shown : (leg.previous ?? null)
  const actualTs = departStop ? actualDeparture(body.mmsi, departStop.id) : null
  const track = aisTrail(body.mmsi)
  const gap = estimate && estimate.track.length > 1 ? estimate.track : []
  const forecast = forecastPath(null, position, destination, atPort)
  const narrative = await narrate({
    shipName: body.shipName,
    locale: body.locale,
    lat: position.lat,
    lng: position.lng,
    currentPort: atPort ? loc(shown) : null,
    nextPort: loc(destination),
    arriveAt: destination.arriveAt,
    departAt: atPort ? shown.departAt : null,
    weather,
    atPort,
    nav,
    zone: null,
    aisDestination,
    aisEta: voyageEta,
  })

  return {
    position,
    tracking,
    seenAt: known ? new Date(known.ts).toISOString() : null,
    seenSource: known ? 'ais' : null,
    motion: {
      nav,
      sogKn: estimate?.sogKn ?? known?.sog ?? null,
      cog: estimate?.heading ?? known?.cog ?? null,
      heading: estimate?.heading ?? known?.heading ?? known?.cog ?? null,
    },
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
    narrative,
    path: routePath(body.stops),
    track,
    gap,
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
}

function pickBerth(
  stops: SnapshotRequest['stops'],
  liveFix: { lat: number; lng: number } | null,
  leg: { previous: SnapshotRequest['stops'][number] | null; next: SnapshotRequest['stops'][number]; atPort: boolean },
  scheduledAtPort: boolean,
  nav: AisNavState,
) {
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
