import type { AisNavState, SeenSource, SnapshotRequest, SnapshotResponse } from '../shared/types.ts'
import { alignLegToFix, estimatedPosition, findLeg, forecastPath, haversineKm, isOffItinerary, nearPort, routePath } from '../shared/geo.ts'
import { isStoppedNav, isUnderwayNav, navStateFromAis, resolveAisDestination } from '../shared/ais.ts'
import { watchMmsi, aisConfigured, waitForLive, aisError, lastKnownPosition, lastAisPosition, actualDeparture, voyageOf, aisTrail, livePosition, AIS_LIVE_MS, aisFallbackGraceActive } from './ais.ts'
import {
  dataDockedConfigured,
  dataDockedError,
  dataDockedStatus,
  lastDataDockedFix,
  refreshDataDockedIfNeeded,
} from './datadocked.ts'
import {
  lastVesselsFix,
  refreshHistoryIfNeeded,
  refreshVesselsIfNeeded,
  vesselsApiStatus,
  vesselsConfigured,
  vesselsLiveMs,
} from './vessels-api.ts'
import { fetchWeather } from './weather.ts'
import { narrate } from './narrate.ts'
import { sunTimes, tzFromLongitude } from '../shared/sun.ts'
import type { DockedFix } from './datadocked.ts'
import type { LiveFix } from './ais.ts'
import { lastManualFix, MANUAL_LIVE_MS, type ManualFix } from './manual-position.ts'

type ReceivedFix = {
  lat: number
  lng: number
  ts: number
  sog?: number | null
  cog?: number | null
  heading?: number | null
  navStatus?: number | null
  source: SeenSource
  liveMs: number
}

export async function buildSnapshot(body: SnapshotRequest): Promise<SnapshotResponse | { error: string; status: 400 }> {
  if (!body?.mmsi || !body.shipName || !body.stops?.length) {
    return { error: 'invalid_request', status: 400 }
  }

  watchMmsi(body.mmsi, body.stops)
  await refreshVesselsIfNeeded().catch(() => {})
  void refreshHistoryIfNeeded().catch(() => {})
  const now = new Date()
  const clockLeg = findLeg(body.stops, now)
  if (!clockLeg) return { error: 'no_route', status: 400 }

  const streamFix = aisConfigured() ? await waitForLive(body.mmsi, 1_500) : lastKnownPosition(body.mmsi)
  const aisFix = lastAisPosition(body.mmsi) ?? streamFix ?? lastKnownPosition(body.mmsi)
  const aisLive = Boolean(livePosition(body.mmsi, AIS_LIVE_MS))
  const vesselsFix = lastVesselsFix(body.mmsi)
  const vesselsFresh = Boolean(vesselsFix && Date.now() - vesselsFix.ts < vesselsLiveMs())
  const manualFix = lastManualFix(body.mmsi)
  const nowMs = now.getTime()
  const skipPaidFetch = aisLive || vesselsFresh || (aisConfigured() && aisFallbackGraceActive())
  const dockedFix = skipPaidFetch
    ? lastDataDockedFix(body.mmsi)
    : ((await refreshDataDockedIfNeeded(body.mmsi, aisLive || vesselsFresh).catch(() => lastDataDockedFix(body.mmsi))) ??
      lastDataDockedFix(body.mmsi))
  const received = pickReceivedFix(aisFix, vesselsFix, dockedFix, manualFix)
  const receivedAge = received ? nowMs - received.ts : Number.POSITIVE_INFINITY
  const receivedLive = Boolean(received && receivedAge < received.liveMs)
  const offItinerary = Boolean(received && isOffItinerary(received, body.stops))
  const leg = received && !offItinerary ? (alignLegToFix(body.stops, now, received) ?? clockLeg) : clockLeg
  const weatherStop = received ?? (leg.previous && !leg.atPort ? leg.previous : leg.next)
  const weatherPromise = fetchWeather(weatherStop.lat, weatherStop.lng, now).catch(() => null)
  const guessed = estimatedPosition(body.stops, now, offItinerary ? null : received, offItinerary ? clockLeg : leg)
  if (!guessed) return { error: 'no_route', status: 400 }

  const streamError = aisError()
  const dockedError = dataDockedError()
  const hasTracker = aisConfigured() || dataDockedConfigured() || vesselsConfigured()

  const tracking = receivedLive
    ? 'live'
    : received
      ? 'last-known'
      : !hasTracker
        ? 'no-key'
        : streamError && !dataDockedConfigured()
          ? 'ais-error'
          : dockedError && !aisConfigured()
            ? 'ais-error'
            : 'estimated'

  const position = received
    ? { lat: received.lat, lng: received.lng, source: receivedLive ? ('live' as const) : ('approx' as const) }
    : { ...guessed.point, source: 'approx' as const }

  const next = guessed.next
  const navCandidate = received
    ? navStateFromAis(received.navStatus, received.sog)
    : guessed.atPort
      ? 'moored'
      : 'unknown'
  const berth = offItinerary ? null : pickBerth(body.stops, received, leg, leg.atPort, navCandidate)
  const atPort = Boolean(berth)
  // If our itinerary says we're in port and berth detection succeeded, force "moored"
  // even when stale AIS navStatus still says underway.
  const nav = atPort ? 'moored' : navCandidate
  const shown = berth ?? next
  const berthIndex = berth ? body.stops.findIndex((stop) => stop.id === berth.id) : -1
  const following = berthIndex >= 0 ? (body.stops[berthIndex + 1] ?? null) : next
  const destination = following ?? shown
  const loc = (stop: { name: string; nameDe: string }) => (body.locale === 'de' ? stop.nameDe : stop.name)
  const streamVoyage = voyageOf(body.mmsi)
  const aisDestination = resolveAisDestination(
    streamVoyage?.destination ?? vesselsFix?.destination ?? dockedFix?.destination ?? null,
    body.stops,
    body.locale,
  )
  const voyageEta = streamVoyage?.eta ?? vesselsFix?.eta ?? dockedFix?.eta ?? null
  const voyage =
    aisDestination || voyageEta ? { destination: aisDestination, eta: voyageEta } : null
  const weather = offItinerary
    ? await fetchWeather(position.lat, position.lng, now).catch(() => null)
    : ((await weatherPromise) ??
      (await fetchWeather(position.lat, position.lng, now).catch(() => null)))

  const departStop = offItinerary ? null : atPort ? shown : (leg.previous ?? null)
  const actualTs = departStop ? actualDeparture(body.mmsi, departStop.id) : null
  const track = aisTrail(body.mmsi)
  const gap = buildGap(track, received, position, [])
  const forecast = offItinerary ? [] : forecastPath(null, position, destination, atPort)
  const narrative = offItinerary
    ? body.locale === 'de'
      ? `${body.shipName} sendet Live-Position, die nicht zum hinterlegten Reiseplan passt.`
      : `${body.shipName} is reporting a live position that does not match this itinerary.`
    : await narrate({
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
    seenAt: received ? new Date(received.ts).toISOString() : null,
    seenSource: received?.source ?? null,
    seenAccuracyM: received?.source === 'manual' ? (manualFix?.accuracyM ?? null) : null,
    motion: {
      nav,
      sogKn: received?.sog ?? null,
      cog: received?.cog ?? null,
      heading: received?.heading ?? received?.cog ?? null,
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
    sun: sunTimes(position.lat, position.lng, now) ?? (weather?.sunrise && weather?.sunset
      ? { sunrise: weather.sunrise, sunset: weather.sunset }
      : null),
    shipTz: weather?.timezone || tzFromLongitude(position.lng),
    narrative,
    path: offItinerary ? [] : routePath(body.stops),
    track,
    gap,
    forecast,
    fromPort: offItinerary ? null : !atPort && leg.previous ? loc(leg.previous) : null,
    offItinerary,
    scheduledPort:
      received && !offItinerary && loc(clockLeg.next) !== loc(destination) ? loc(clockLeg.next) : null,
    distanceKm: offItinerary || atPort ? null : Math.round(haversineKm(position, destination)),
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
          lastError: dockedStatus.lastError,
        }
      : null,
    vesselsApi: vesselsConfigured() ? vesselsApiStatus() : null,
  }
}

function pickReceivedFix(
  ais: LiveFix | null,
  vessels: LiveFix | null,
  docked: DockedFix | null,
  manual: ManualFix | null,
): ReceivedFix | null {
  const candidates: ReceivedFix[] = []
  if (ais) candidates.push(toReceived(ais, 'ais', AIS_LIVE_MS))
  if (vessels) candidates.push(toReceived(vessels, 'vessels', vesselsLiveMs()))
  if (docked) candidates.push(toReceived(docked, 'datadocked', AIS_LIVE_MS))
  if (manual) candidates.push(toReceived(manual, 'manual', MANUAL_LIVE_MS))
  if (!candidates.length) return null
  return candidates.reduce((newest, row) => (row.ts > newest.ts ? row : newest))
}

function toReceived(
  fix: { lat: number; lng: number; ts: number; sog?: number | null; cog?: number | null; heading?: number | null; navStatus?: number | null },
  source: SeenSource,
  liveMs: number,
): ReceivedFix {
  return {
    lat: fix.lat,
    lng: fix.lng,
    ts: fix.ts,
    sog: fix.sog ?? null,
    cog: fix.cog ?? null,
    heading: fix.heading ?? null,
    navStatus: fix.navStatus ?? null,
    source,
    liveMs,
  }
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
  if (leg.previous && nearPort(liveFix, leg.previous)) return leg.previous
  if (leg.atPort && nearPort(liveFix, leg.next)) return leg.next
  if (isStoppedNav(nav)) return nearest
  // When we *expect* to be in port, don't discard berth detection solely because stale AIS
  // still reports "underway". Otherwise we would stay stuck on interpolated routes.
  if (isUnderwayNav(nav) && !scheduledAtPort) return null
  return nearest
}
