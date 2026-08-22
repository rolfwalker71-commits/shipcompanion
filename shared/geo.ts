import type { GeoPoint, PortStop, PositionSource } from './types.ts'

export type RouteLeg = {
  previous: PortStop | null
  next: PortStop
  atPort: boolean
}

export type LastFix = GeoPoint & { ts: number }

export function findLeg(stops: PortStop[], now = new Date()): RouteLeg | null {
  if (stops.length === 0) return null

  const t = now.getTime()
  const first = stops[0]
  const last = stops[stops.length - 1]

  if (t <= new Date(first.arriveAt).getTime()) {
    return { previous: null, next: first, atPort: true }
  }

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i]
    const arrive = new Date(stop.arriveAt).getTime()
    const depart = new Date(stop.departAt).getTime()
    if (t >= arrive && t <= depart) {
      return { previous: stop, next: stop, atPort: true }
    }
    const following = stops[i + 1]
    if (following && t > depart && t < new Date(following.arriveAt).getTime()) {
      return { previous: stop, next: following, atPort: false }
    }
  }

  return { previous: last, next: last, atPort: true }
}

export function interpolate(a: GeoPoint, b: GeoPoint, u: number): GeoPoint {
  const t = Math.min(1, Math.max(0, u))
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  }
}

export type MotionHint = GeoPoint & {
  ts: number
  sogKn?: number | null
  cog?: number | null
}

export type EstimateTrack = {
  point: GeoPoint
  heading: number | null
  sogKn: number
  track: GeoPoint[]
}

const EARTH_KM = 6371
const DEFAULT_CRUISE_KN = 17
const ESTIMATE_STEPS = 12

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function toDeg(radians: number): number {
  return (radians * 180) / Math.PI
}

/** Planned route is ignored for camera/status when GPS is farther than this from every stop. */
export const OFF_ITINERARY_KM = 400
/** GPS this close to a harbor can retarget the next port, even if the clock says another stop. */
const GPS_APPROACH_KM = 180
const GPS_WRONG_PORT_KM = 300
const SAME_HARBOR_KM = 15

export function nearestStopKm(point: GeoPoint, stops: GeoPoint[]): number | null {
  if (!stops.length) return null
  return Math.min(...stops.map((stop) => haversineKm(point, stop)))
}

export function isOffItinerary(point: GeoPoint, stops: GeoPoint[]): boolean {
  const nearest = nearestStopKm(point, stops)
  return nearest != null && nearest > OFF_ITINERARY_KM
}

function sameHarbor(a: GeoPoint, b: GeoPoint): boolean {
  return haversineKm(a, b) < SAME_HARBOR_KM
}

/** If GPS is clearly at/near a different itinerary harbor than the clock, follow the GPS. */
export function alignLegToFix(stops: PortStop[], now: Date, fix: GeoPoint): RouteLeg | null {
  const scheduled = findLeg(stops, now)
  if (!scheduled || stops.length === 0) return scheduled

  const nowMs = now.getTime()
  const scored = stops.map((stop, index) => ({ stop, index, km: haversineKm(fix, stop) }))
  const nearest = scored.reduce((best, row) => (row.km < best.km ? row : best))
  const scheduledKm = haversineKm(fix, scheduled.next)
  if (
    nearest.km > GPS_APPROACH_KM ||
    scheduledKm <= GPS_WRONG_PORT_KM ||
    sameHarbor(nearest.stop, scheduled.next)
  ) {
    return scheduled
  }

  const cluster = scored.filter((row) => sameHarbor(row.stop, nearest.stop))
  const inWindow = cluster.find((row) => {
    const arrive = new Date(row.stop.arriveAt).getTime()
    const depart = new Date(row.stop.departAt).getTime()
    return nowMs >= arrive && nowMs <= depart
  })
  const upcoming = [...cluster]
    .filter((row) => nowMs <= new Date(row.stop.departAt).getTime() + 6 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.stop.arriveAt).getTime() - new Date(b.stop.arriveAt).getTime())[0]
  const latest = [...cluster].sort(
    (a, b) => new Date(b.stop.arriveAt).getTime() - new Date(a.stop.arriveAt).getTime(),
  )[0]
  const stillThere = latest && nearPort(fix, latest.stop, 8) ? latest : null
  const chosen = inWindow ?? upcoming ?? stillThere
  if (!chosen) return scheduled

  const docked = nearPort(fix, chosen.stop, 8)
  if (docked) {
    return { previous: chosen.stop, next: chosen.stop, atPort: true }
  }

  const prior = stops
    .slice(0, chosen.index)
    .filter((stop) => !sameHarbor(stop, chosen.stop))
    .map((stop) => ({ stop, km: haversineKm(fix, stop) }))
    .sort((a, b) => a.km - b.km)[0]
  return {
    previous: prior?.stop ?? (chosen.index > 0 ? stops[chosen.index - 1] : null),
    next: chosen.stop,
    atPort: false,
  }
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bearingDeg(from: GeoPoint, to: GeoPoint): number {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat))
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function destinationPoint(from: GeoPoint, bearing: number, distanceKm: number): GeoPoint {
  const ang = distanceKm / EARTH_KM
  const br = toRad(bearing)
  const lat1 = toRad(from.lat)
  const lng1 = toRad(from.lng)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br))
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 }
}

function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return (from + delta * Math.min(1, Math.max(0, t)) + 360) % 360
}

function cruiseKn(sogKn: number | null | undefined, remainingKm: number, remainingHours: number): number {
  if (sogKn != null && sogKn >= 1 && sogKn < 40) return sogKn
  if (remainingHours > 0.4 && remainingKm > 5) return Math.min(22, Math.max(8, remainingKm / 1.852 / remainingHours))
  return DEFAULT_CRUISE_KN
}

/** Dead-reckon from the last received fix toward the next port (course blends from last COG). */
export function estimateUnderway(from: MotionHint, nextPort: GeoPoint, now: Date, arriveAt?: string): EstimateTrack {
  const hours = Math.max(0, (now.getTime() - from.ts) / 3_600_000)
  const remainingKm = haversineKm(from, nextPort)
  const remainingHours = arriveAt ? Math.max(0.5, (new Date(arriveAt).getTime() - now.getTime()) / 3_600_000) : 18
  const kn = cruiseKn(from.sogKn ?? null, remainingKm, remainingHours + hours)
  const toNext = bearingDeg(from, nextPort)
  const startCourse = from.cog != null && Number.isFinite(from.cog) ? ((from.cog % 360) + 360) % 360 : toNext
  const track: GeoPoint[] = [{ lat: from.lat, lng: from.lng }]
  let point = track[0]
  let heading = startCourse
  const steps = hours < 0.15 ? 1 : ESTIMATE_STEPS
  for (let i = 1; i <= steps; i += 1) {
    const tHours = (hours * i) / steps
    const travelKm = Math.min(remainingKm, kn * 1.852 * tHours)
    const blend = Math.min(1, tHours / 8)
    heading = lerpAngle(startCourse, toNext, blend)
    point = destinationPoint(from, heading, travelKm)
    if (haversineKm(from, point) >= remainingKm - 0.5) {
      point = { lat: nextPort.lat, lng: nextPort.lng }
      heading = toNext
      track.push(point)
      break
    }
    track.push(point)
  }
  return { point, heading, sogKn: kn, track }
}

export function nearPort(point: GeoPoint, port: GeoPoint, km = 8): boolean {
  return haversineKm(point, port) <= km
}

export function estimatedPosition(
  stops: PortStop[],
  now = new Date(),
  lastFix?: LastFix | null,
  legOverride?: RouteLeg | null,
): { point: GeoPoint; source: PositionSource; next: PortStop; atPort: boolean } | null {
  const leg = legOverride ?? findLeg(stops, now)
  if (!leg) return null

  if (leg.atPort || !leg.previous) {
    return {
      point: { lat: leg.next.lat, lng: leg.next.lng },
      source: 'approx',
      next: leg.next,
      atPort: true,
    }
  }

  const departed = new Date(leg.previous.departAt).getTime()
  const arrive = new Date(leg.next.arriveAt).getTime()
  const freshEnough =
    lastFix &&
    lastFix.ts >= departed - 3 * 60 * 60 * 1000 &&
    !nearPort(lastFix, leg.next, 20)

  const from: LastFix = freshEnough
    ? lastFix
    : { lat: leg.previous.lat, lng: leg.previous.lng, ts: departed }
  const span = arrive - from.ts
  const u = span <= 0 ? 1 : (now.getTime() - from.ts) / span
  return {
    point: interpolate(from, leg.next, u),
    source: 'approx',
    next: leg.next,
    atPort: false,
  }
}

export function mockPosition(
  stops: PortStop[],
  now = new Date(),
): { point: GeoPoint; source: PositionSource; next: PortStop } | null {
  const estimated = estimatedPosition(stops, now)
  return estimated ? { point: estimated.point, source: estimated.source, next: estimated.next } : null
}

export function routePath(stops: PortStop[]): GeoPoint[] {
  return stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))
}

export function forecastPath(
  lastAis: GeoPoint | null,
  current: GeoPoint,
  nextPort: GeoPoint,
  atPort: boolean,
): GeoPoint[] {
  if (atPort) return []
  const start = lastAis ?? current
  const points: GeoPoint[] = [{ lat: start.lat, lng: start.lng }]
  if (haversineKm(start, current) > 0.4) {
    points.push({ lat: current.lat, lng: current.lng })
  }
  if (haversineKm(points[points.length - 1], nextPort) > 1.5) {
    points.push({ lat: nextPort.lat, lng: nextPort.lng })
  }
  return points.length >= 2 ? points : []
}

export function shiftStopsToStart(stops: PortStop[], startDate: string): PortStop[] {
  if (!stops.length || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return stops
  const first = new Date(stops[0].arriveAt)
  const [year, month, day] = startDate.split('-').map(Number)
  const desired = new Date(first)
  desired.setFullYear(year, month - 1, day)
  const deltaDays = Math.round((startOfLocalDay(desired) - startOfLocalDay(first)) / 86_400_000)
  if (deltaDays === 0) return stops.map((stop) => ({ ...stop }))
  return stops.map((stop) => ({
    ...stop,
    arriveAt: addLocalDays(stop.arriveAt, deltaDays),
    departAt: addLocalDays(stop.departAt, deltaDays),
  }))
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function addLocalDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

export function aisBoundingBox(stops: PortStop[]): [[number, number], [number, number]] {
  const lats = stops.map((stop) => stop.lat)
  const lngs = stops.map((stop) => stop.lng)
  const pad = 8
  return [
    [Math.max(-90, Math.min(...lats) - pad), Math.max(-180, Math.min(...lngs) - pad)],
    [Math.min(90, Math.max(...lats) + pad), Math.min(180, Math.max(...lngs) + pad)],
  ]
}
