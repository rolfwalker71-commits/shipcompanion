import type { AisNavState, SnapshotRequest, SnapshotResponse } from '../shared/types.ts'
import { estimatedPosition, estimateUnderway, findLeg, forecastPath, haversineKm, nearPort, routePath } from '../shared/geo.ts'
import { isStoppedNav, isUnderwayNav, navStateFromAis, resolveAisDestination } from '../shared/ais.ts'
import { watchMmsi, aisConfigured, waitForLive, aisError, lastKnownPosition, lastAisPosition, actualDeparture, voyageOf, aisTrail } from './ais.ts'
import {
  dataDockedConfigured,
  dataDockedError,
  dataDockedStatus,
  lastDataDockedFix,
  refreshDataDockedIfNeeded,
} from './datadocked.ts'
import { fetchWeather } from './weather.ts'
import { narrate } from './narrate.ts'
import type { DockedFix } from './datadocked.ts'
import type { LiveFix } from './ais.ts'

type ReceivedFix = {
  lat: number
  lng: number
  ts: number
  sog?: number | null
  cog?: number | null
  heading?: number | null
  navStatus?: number | null
  fromDocked: boolean
}

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
  const aisFix = lastAisPosition(body.mmsi) ?? streamFix ?? lastKnownPosition(body.mmsi)
  const liveMs = 45 * 60 * 1000
  const aisAge = aisFix ? now.getTime() - aisFix.ts : Number.POSITIVE_INFINITY
  const aisLive = Boolean(aisFix) && aisAge < liveMs
  const dockedFix =
    (await refreshDataDockedIfNeeded(body.mmsi, aisLive).catch(() => lastDataDockedFix())) ?? lastDataDockedFix()
  const received = pickReceivedFix(aisFix, dockedFix)
  const receivedAge = received ? now.getTime() - received.ts : Number.POSITIVE_INFINITY
  const receivedLive = Boolean(received) && receivedAge < liveMs
  const guessed = estimatedPosition(body.stops, now, received)
  if (!guessed) return { error: 'no_route', status: 400 }

  const streamError = aisError()
  const dockedError = dataDockedError()
  const hasTracker = aisConfigured() || dataDockedConfigured()
  const estimate =
    !receivedLive && received && !guessed.atPort
      ? estimateUnderway(
          {
            lat: received.lat,
            lng: received.lng,
            ts: received.ts,
            sogKn: received.sog,
            cog: received.cog ?? received.heading,
          },
          guessed.next,
          now,
          guessed.next.arriveAt,
        )
      : null

  const tracking = receivedLive
    ? 'live'
    : estimate
      ? 'estimated'
      : received
        ? 'last-known'
        : !hasTracker
          ? 'no-key'
          : streamError && !dataDockedConfigured()
            ? 'ais-error'
            : dockedError && !aisConfigured()
              ? 'ais-error'
              : 'estimated'

  const position = receivedLive && received
    ? { lat: received.lat, lng: received.lng, source: 'live' as const }
    : estimate
      ? { lat: estimate.point.lat, lng: estimate.point.lng, source: 'approx' as const }
      : guessed.atPort
        ? { ...guessed.point, source: 'approx' as const }
        : received
          ? { lat: received.lat, lng: received.lng, source: 'approx' as const }
          : { ...guessed.point, source: 'approx' as const }

  const next = guessed.next
  const nav = estimate
    ? 'underway'
    : received
      ? navStateFromAis(received.navStatus, received.sog)
      : guessed.atPort
        ? 'moored'
        : 'unknown'
  const berth = estimate ? null : pickBerth(body.stops, received, leg, guessed.atPort, nav)
  const atPort = Boolean(berth)
  const shown = berth ?? next
  const berthIndex = berth ? body.stops.findIndex((stop) => stop.id === berth.id) : -1
  const following = berthIndex >= 0 ? (body.stops[berthIndex + 1] ?? null) : next
  const destination = following ?? shown
  const loc = (stop: { name: string; nameDe: string }) => (body.locale === 'de' ? stop.nameDe : stop.name)
  const streamVoyage = voyageOf(body.mmsi)
  const aisDestination = resolveAisDestination(
    streamVoyage?.destination ?? dockedFix?.destination ?? null,
    body.stops,
    body.locale,
  )
  const voyageEta = streamVoyage?.eta ?? dockedFix?.eta ?? null
  const voyage =
    aisDestination || voyageEta ? { destination: aisDestination, eta: voyageEta } : null
  const weather =
    (await weatherPromise) ??
    (await fetchWeather(position.lat, position.lng, now).catch(() => null))

  const departStop = atPort ? shown : (leg.previous ?? null)
  const actualTs = departStop ? actualDeparture(body.mmsi, departStop.id) : null
  const track = aisTrail(body.mmsi)
  const gap = buildGap(track, received, position, estimate?.track ?? [])
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
  const dockedStatus = dataDockedStatus()

  return {
    position,
    tracking,
    seenAt: aisFix ? new Date(aisFix.ts).toISOString() : null,
    seenSource: received?.fromDocked ? 'datadocked' : received ? 'ais' : null,
    motion: {
      nav,
      sogKn: estimate?.sogKn ?? received?.sog ?? null,
      cog: estimate?.heading ?? received?.cog ?? null,
      heading: estimate?.heading ?? received?.heading ?? received?.cog ?? null,
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
    dataDocked: dockedStatus.configured
      ? {
          remaining: dockedStatus.credits ?? dockedStatus.remaining,
          monthlyLimit: dockedStatus.monthlyLimit,
          seenAt: dockedFix ? new Date(dockedFix.ts).toISOString() : null,
          source: dockedFix?.source ?? null,
        }
      : null,
  }
}

function pickReceivedFix(ais: LiveFix | null, docked: DockedFix | null): ReceivedFix | null {
  if (!docked) return ais ? { ...ais, fromDocked: false } : null
  if (!ais) return { ...docked, fromDocked: true }
  if (docked.ts > ais.ts + 60_000) return { ...docked, fromDocked: true }
  if (haversineKm(ais, docked) > 2 && docked.ts + 5 * 60_000 >= ais.ts) return { ...docked, fromDocked: true }
  return ais.ts >= docked.ts ? { ...ais, fromDocked: false } : { ...docked, fromDocked: true }
}

function buildGap(
  track: { lat: number; lng: number }[],
  received: ReceivedFix | null,
  position: { lat: number; lng: number },
  estimateTrack: { lat: number; lng: number }[],
): { lat: number; lng: number }[] {
  const trailEnd = track[track.length - 1] ?? null
  const head = estimateTrack[0] ?? received ?? position
  const jump =
    trailEnd && haversineKm(trailEnd, head) > 8
      ? [{ lat: trailEnd.lat, lng: trailEnd.lng }, { lat: head.lat, lng: head.lng }]
      : []
  if (estimateTrack.length > 1) {
    return jump.length ? [jump[0], ...estimateTrack] : estimateTrack
  }
  if (jump.length && haversineKm(head, position) > 1) return [...jump, { lat: position.lat, lng: position.lng }]
  return jump
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
