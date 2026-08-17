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

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const earth = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)))
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function nearPort(point: GeoPoint, port: GeoPoint, km = 8): boolean {
  return haversineKm(point, port) <= km
}

export function estimatedPosition(
  stops: PortStop[],
  now = new Date(),
  lastFix?: LastFix | null,
): { point: GeoPoint; source: PositionSource; next: PortStop; atPort: boolean } | null {
  const leg = findLeg(stops, now)
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
