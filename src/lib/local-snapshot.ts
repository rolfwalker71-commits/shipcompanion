import type { Locale, SnapshotResponse, Trip } from '@shared/types.ts'
import { estimatedPosition, findLeg, forecastPath, haversineKm, routePath } from '@shared/geo.ts'
import { tripShip } from '@shared/ships.ts'
import { formatWhen } from '@shared/time.ts'

export function scheduleSnapshot(trip: Trip, locale: Locale): SnapshotResponse | null {
  const guessed = estimatedPosition(trip.stops)
  const leg = findLeg(trip.stops)
  const ship = tripShip(trip)
  if (!guessed || !leg || !ship) return null

  const atPort = guessed.atPort
  const dest = guessed.next
  const shownStop = atPort ? dest : (leg.previous ?? dest)
  const loc = (stop: { name: string; nameDe: string }) => (locale === 'de' ? stop.nameDe : stop.name)
  const arrival = formatWhen(dest.arriveAt, locale, true)
  const fromPort = !atPort && leg.previous ? loc(leg.previous) : null
  const narrative =
    atPort
      ? locale === 'de'
        ? `${ship.name} liegt in ${loc(dest)}.`
        : `${ship.name} is in ${loc(dest)}.`
      : locale === 'de'
        ? `${ship.name} ist unterwegs nach ${loc(dest)}${fromPort ? ` von ${fromPort}` : ''}. Ankunft ${arrival}.`
        : `${ship.name} is on the way to ${loc(dest)}${fromPort ? ` from ${fromPort}` : ''}. Arrival ${arrival}.`

  return {
    position: { ...guessed.point, source: 'approx' },
    tracking: 'estimated',
    seenAt: null,
    seenSource: null,
    motion: {
      nav: atPort ? 'moored' : 'underway',
      sogKn: null,
      cog: null,
      heading: null,
    },
    voyage: null,
    nextPort: {
      name: loc(dest),
      arriveAt: dest.arriveAt,
      lat: dest.lat,
      lng: dest.lng,
      atPort,
      berthName: atPort ? loc(dest) : null,
      departAt: atPort ? dest.departAt : null,
    },
    departure: {
      portName: loc(shownStop),
      planned: shownStop.departAt,
      actual: null,
    },
    fromPort,
    distanceKm: !atPort ? Math.round(haversineKm(guessed.point, dest)) : null,
    weather: null,
    narrative,
    path: routePath(trip.stops),
    track: [],
    gap: [],
    forecast: forecastPath(null, guessed.point, dest, atPort),
    dataDocked: null,
  }
}
