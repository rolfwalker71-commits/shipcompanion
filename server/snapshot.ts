import type { AisNavState, SnapshotRequest, SnapshotResponse } from '../shared/types.ts'
import { estimatedPosition, findLeg, forecastPath, haversineKm, nearPort, routePath } from '../shared/geo.ts'
import { isStoppedNav, isUnderwayNav, navStateFromAis, resolveAisDestination } from '../shared/ais.ts'
import { watchMmsi, aisConfigured, waitForLive, aisError, lastKnownPosition, lastAisPosition, actualDeparture, voyageOf, aisTrail, rememberExternalFix } from './ais.ts'
import {
  lastVesselFinderFix,
  refreshVesselFinderIfNeeded,
  vesselFinderConfigured,
  vesselFinderError,
  vesselFinderStatus,
} from './vesselfinder.ts'
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
  const known = streamFix ?? lastKnownPosition(body.mmsi)
  const liveMs = 45 * 60 * 1000
  const streamAge = known ? now.getTime() - known.ts : Number.POSITIVE_INFINITY
  const streamLive = Boolean(known) && streamAge < liveMs
  const finderFix =
    (await refreshVesselFinderIfNeeded(body.mmsi, body.imo, streamLive).catch(() => lastVesselFinderFix())) ??
    lastVesselFinderFix()

  if (finderFix) {
    rememberExternalFix(body.mmsi, {
      lat: finderFix.lat,
      lng: finderFix.lng,
      ts: finderFix.ts,
      sog: finderFix.sog,
      cog: finderFix.cog,
      heading: finderFix.heading,
      navStatus: finderFix.navStatus,
    })
  }
  const aisPoint = pickReceivedFix(known, finderFix)
  const usedVesselFinder = Boolean(aisPoint && finderFix && aisPoint === finderFix)
  const aisAge = aisPoint ? now.getTime() - aisPoint.ts : Number.POSITIVE_INFINITY
  const aisLive = Boolean(aisPoint) && aisAge < liveMs
  const guessed = estimatedPosition(body.stops, now, null)
  if (!guessed) return { error: 'no_route', status: 400 }

  const streamError = aisError()
  const finderError = vesselFinderError(body.mmsi)
  const hasTracker = aisConfigured() || vesselFinderConfigured()
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
  const motionFix = streamLive && known ? known : finderFix ?? known
  const nav = motionFix
    ? navStateFromAis(motionFix.navStatus, motionFix.sog)
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
  const voyageEta = streamVoyage?.eta ?? finderFix?.eta ?? null
  const voyage =
    aisDestination || voyageEta ? { destination: aisDestination, eta: voyageEta } : null
  const weather =
    (await weatherPromise) ??
    (await fetchWeather(position.lat, position.lng, now).catch(() => null))

  const lastStamp = aisPoint ?? known ?? finderFix
  const departStop = atPort ? shown : (leg.previous ?? null)
  const actualTs = departStop ? actualDeparture(body.mmsi, departStop.id) : null
  const track = aisTrail(body.mmsi)
  const trailEnd = track[track.length - 1] ?? (known ? { lat: known.lat, lng: known.lng } : null)
  const gap =
    trailEnd && haversineKm(trailEnd, position) > 8
      ? [{ lat: trailEnd.lat, lng: trailEnd.lng }, { lat: position.lat, lng: position.lng }]
      : []
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
    zone: finderFix?.zone ?? null,
    aisDestination,
    aisEta: voyageEta,
  })

  return {
    position,
    tracking,
    seenAt: (() => {
      const ais = lastAisPosition(body.mmsi)
      if (ais) return new Date(ais.ts).toISOString()
      if (lastStamp && !usedVesselFinder) return new Date(lastStamp.ts).toISOString()
      return null
    })(),
    seenSource: usedVesselFinder ? 'vesselfinder' : aisPoint ? 'ais' : null,
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
    vesselFinder: (() => {
      const status = vesselFinderStatus()
      if (!status.configured) return null
      return {
        remaining: status.remaining,
        monthlyLimit: status.monthlyLimit,
        seenAt: finderFix ? new Date(finderFix.ts).toISOString() : null,
      }
    })(),
  }
}

function pickReceivedFix<T extends { lat: number; lng: number; ts: number }>(
  ais: T | null,
  vessel: T | null,
): T | null {
  if (!vessel) return ais
  if (!ais) return vessel
  if (vessel.ts > ais.ts + 60_000) return vessel
  if (haversineKm(ais, vessel) > 2) return vessel
  return ais.ts >= vessel.ts ? ais : vessel
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
