import type { AisNavState, SeenSource, SnapshotRequest, SnapshotResponse } from '../shared/types.ts'
import { alignLegToFix, estimatedPosition, findLeg, forecastPath, haversineKm, isOffItinerary, nearPort, routePath } from '../shared/geo.ts'
import { isStoppedNav, isUnderwayNav, navStateFromAis, resolveAisDestination } from '../shared/ais.ts'
import { harborNear, matchHarbor } from '../shared/harbors.ts'
import { watchMmsi, aisConfigured, waitForLive, aisError, lastKnownPosition, lastAisPosition, actualDeparture, voyageOf, lastPortOf, aisTrail, livePosition, AIS_LIVE_MS, aisFallbackGraceActive } from './ais.ts'
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
  if (!body?.mmsi || !body.shipName) {
    return { error: 'invalid_request', status: 400 }
  }
  const stops = Array.isArray(body.stops) ? body.stops : []
  const hasPlan = stops.length > 0

  watchMmsi(body.mmsi, stops)
  await refreshVesselsIfNeeded().catch(() => {})
  void refreshHistoryIfNeeded().catch(() => {})
  const now = new Date()
  const clockLeg = hasPlan ? findLeg(stops, now) : null
  if (hasPlan && !clockLeg) return { error: 'no_route', status: 400 }

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
  const streamVoyage = voyageOf(body.mmsi)
  const aisDestination = resolveAisDestination(
    streamVoyage?.destination ?? vesselsFix?.destination ?? dockedFix?.destination ?? null,
    stops,
    body.locale,
  )
  const voyageEta = streamVoyage?.eta ?? vesselsFix?.eta ?? dockedFix?.eta ?? null
  const voyage =
    aisDestination || voyageEta ? { destination: aisDestination, eta: voyageEta } : null

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

  const loc = (stop: { name: string; nameDe: string }) => (body.locale === 'de' ? stop.nameDe : stop.name)
  const track = aisTrail(body.mmsi)
  const plan = hasPlan && clockLeg
    ? plannedView({
        stops,
        clockLeg,
        received,
        now,
        locale: body.locale,
        loc,
        mmsi: body.mmsi,
      })
    : null
  const radio = !plan
    ? radioView({
        received,
        locale: body.locale,
        aisDestination,
        voyageEta,
        mmsi: body.mmsi,
      })
    : null
  const view = plan ?? radio
  if (!view) return { error: 'no_route', status: 400 }

  const position = received
    ? { lat: received.lat, lng: received.lng, source: receivedLive ? ('live' as const) : ('approx' as const) }
    : { ...view.position, source: 'approx' as const }

  const weather = await fetchWeather(position.lat, position.lng, now).catch(() => null)
  const narrative = view.offItinerary
    ? body.locale === 'de'
      ? `${body.shipName} sendet Live-Position, die nicht zum hinterlegten Reiseplan passt.`
      : `${body.shipName} is reporting a live position that does not match this itinerary.`
    : await narrate({
        shipName: body.shipName,
        locale: body.locale,
        lat: position.lat,
        lng: position.lng,
        currentPort: view.atPort ? view.hereName : null,
        nextPort: view.nextName,
        arriveAt: view.arriveAt,
        departAt: view.departAt,
        weather,
        atPort: view.atPort,
        nav: view.nav,
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
      nav: view.nav,
      sogKn: received?.sog ?? null,
      cog: received?.cog ?? null,
      heading: received?.heading ?? received?.cog ?? null,
    },
    voyage,
    nextPort: {
      name: view.nextName,
      arriveAt: view.arriveAt,
      lat: view.nextLat,
      lng: view.nextLng,
      atPort: view.atPort,
      berthName: view.atPort ? view.hereName : null,
      departAt: view.departAt,
    },
    weather,
    sun: sunTimes(position.lat, position.lng, now) ?? (weather?.sunrise && weather?.sunset
      ? { sunrise: weather.sunrise, sunset: weather.sunset }
      : null),
    shipTz: weather?.timezone || tzFromLongitude(position.lng),
    narrative,
    path: view.path,
    track,
    gap: buildGap(track, received, position, []),
    forecast: view.forecast,
    fromPort: view.fromPort,
    offItinerary: view.offItinerary,
    scheduledPort: view.scheduledPort,
    distanceKm: view.distanceKm,
    departure: view.departure,
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

type RouteView = {
  position: { lat: number; lng: number }
  nav: AisNavState
  nextName: string
  nextLat: number
  nextLng: number
  arriveAt: string | null
  hereName: string | null
  atPort: boolean
  departAt: string | null
  fromPort: string | null
  path: { lat: number; lng: number }[]
  forecast: { lat: number; lng: number }[]
  offItinerary: boolean
  scheduledPort: string | null
  distanceKm: number | null
  departure: { portName: string; planned: string; actual: string | null } | null
}

function plannedView(input: {
  stops: SnapshotRequest['stops']
  clockLeg: NonNullable<ReturnType<typeof findLeg>>
  received: ReceivedFix | null
  now: Date
  locale: SnapshotRequest['locale']
  loc: (stop: { name: string; nameDe: string }) => string
  mmsi: string
}): RouteView | null {
  const offItinerary = Boolean(input.received && isOffItinerary(input.received, input.stops))
  const leg =
    input.received && !offItinerary
      ? (alignLegToFix(input.stops, input.now, input.received) ?? input.clockLeg)
      : input.clockLeg
  const guessed = estimatedPosition(
    input.stops,
    input.now,
    offItinerary ? null : input.received,
    offItinerary ? input.clockLeg : leg,
  )
  if (!guessed) return null
  const navCandidate = input.received
    ? navStateFromAis(input.received.navStatus, input.received.sog)
    : guessed.atPort
      ? 'moored'
      : 'unknown'
  const berth = offItinerary ? null : pickBerth(input.stops, input.received, leg, leg.atPort, navCandidate)
  const atPort = Boolean(berth)
  const nav = atPort ? 'moored' : navCandidate
  const next = guessed.next
  const shown = berth ?? next
  const berthIndex = berth ? input.stops.findIndex((stop) => stop.id === berth.id) : -1
  const following = berthIndex >= 0 ? (input.stops[berthIndex + 1] ?? null) : next
  const destination = following ?? shown
  const departStop = offItinerary ? null : atPort ? shown : (leg.previous ?? null)
  const actualTs = departStop ? actualDeparture(input.mmsi, departStop.id) : null
  const position = input.received ?? guessed.point
  return {
    position,
    nav,
    nextName: input.loc(destination),
    nextLat: destination.lat,
    nextLng: destination.lng,
    arriveAt: destination.arriveAt,
    hereName: atPort ? input.loc(shown) : null,
    atPort,
    departAt: atPort ? shown.departAt : null,
    fromPort: offItinerary ? null : !atPort && leg.previous ? input.loc(leg.previous) : null,
    path: offItinerary ? [] : routePath(input.stops),
    forecast: offItinerary ? [] : forecastPath(null, position, destination, atPort),
    offItinerary,
    scheduledPort:
      input.received && !offItinerary && input.loc(input.clockLeg.next) !== input.loc(destination)
        ? input.loc(input.clockLeg.next)
        : null,
    distanceKm: offItinerary || atPort ? null : Math.round(haversineKm(position, destination)),
    departure: departStop
      ? {
          portName: input.loc(departStop),
          planned: departStop.departAt,
          actual: actualTs ? new Date(actualTs).toISOString() : null,
        }
      : null,
  }
}

function radioView(input: {
  received: ReceivedFix | null
  locale: SnapshotRequest['locale']
  aisDestination: string | null
  voyageEta: string | null
  mmsi: string
}): RouteView | null {
  const destHarbor = matchHarbor(input.aisDestination)
  const here = input.received ? harborNear(input.received, 8) : null
  const nav = input.received ? navStateFromAis(input.received.navStatus, input.received.sog) : 'unknown'
  const parked =
    Boolean(here) &&
    (isStoppedNav(nav) || (nav === 'unknown' && (input.received?.sog == null || input.received.sog < 1.2)))
  const locHarbor = (harbor: { name: string; nameDe: string }) =>
    input.locale === 'de' ? harbor.nameDe : harbor.name
  const hereName = here ? locHarbor(here) : null
  const destName = input.aisDestination
  const destIsHere = Boolean(here && destHarbor && here.id === destHarbor.id)
  const nextName = destName && !destIsHere ? destName : destName ?? hereName ?? ''
  const nextPoint = destHarbor ?? here ?? input.received
  if (!input.received && !destHarbor && !destName) return null
  const position = input.received ?? destHarbor ?? { lat: 30, lng: -30 }
  const last = lastPortOf(input.mmsi)
  const lastName = last ? (input.locale === 'de' ? last.nameDe : last.name) : null
  const fromPort = !parked && lastName && lastName !== nextName ? lastName : null
  return {
    position,
    nav: parked ? 'moored' : nav,
    nextName,
    nextLat: nextPoint?.lat ?? position.lat,
    nextLng: nextPoint?.lng ?? position.lng,
    arriveAt: input.voyageEta,
    hereName: parked ? hereName : null,
    atPort: parked,
    departAt: null,
    fromPort,
    path: [],
    forecast:
      destHarbor && input.received && !parked && !destIsHere
        ? forecastPath(null, input.received, destHarbor, false)
        : [],
    offItinerary: false,
    scheduledPort: null,
    distanceKm:
      destHarbor && input.received && !parked && !destIsHere
        ? Math.round(haversineKm(input.received, destHarbor))
        : null,
    departure: null,
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
