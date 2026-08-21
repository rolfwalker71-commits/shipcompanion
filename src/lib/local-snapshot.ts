import type { Locale, SnapshotResponse, Trip } from '@shared/types.ts'
import { estimatedPosition, findLeg, forecastPath, haversineKm, routePath } from '@shared/geo.ts'
import { tripShip } from '@shared/ships.ts'
import { sunTimes, tzFromLongitude } from '@shared/sun.ts'
import { formatWhen } from '@shared/time.ts'

export function scheduleSnapshot(trip: Trip, locale: Locale): SnapshotResponse | null {
  const guessed = estimatedPosition(trip.stops)
  const leg = findLeg(trip.stops)
  const ship = tripShip(trip)
  if (!guessed || !leg || !ship) return null

  const atPort = guessed.atPort
  const dest = guessed.next
  const berthIndex = atPort ? trip.stops.findIndex((stop) => stop.id === dest.id) : -1
  const following = berthIndex >= 0 ? (trip.stops[berthIndex + 1] ?? null) : null
  const destination = following ?? dest
  const shownStop = atPort ? dest : (leg.previous ?? dest)
  const loc = (stop: { name: string; nameDe: string }) => (locale === 'de' ? stop.nameDe : stop.name)
  const arrival = formatWhen(destination.arriveAt, locale, true)
  const fromPort = !atPort && leg.previous ? loc(leg.previous) : null
  const narrative =
    atPort
      ? locale === 'de'
        ? `${ship.name} liegt in ${loc(dest)}. Nächster Hafen: ${loc(destination)} (Ankunft ${arrival}).`
        : `${ship.name} is in ${loc(dest)}. Next port: ${loc(destination)} (arrival ${arrival}).`
      : locale === 'de'
        ? `${ship.name} ist unterwegs nach ${loc(destination)}${fromPort ? ` von ${fromPort}` : ''}. Ankunft ${arrival}.`
        : `${ship.name} is on the way to ${loc(destination)}${fromPort ? ` from ${fromPort}` : ''}. Arrival ${arrival}.`

  return {
    position: { ...guessed.point, source: 'approx' },
    tracking: 'estimated',
    seenAt: null,
    seenSource: null,
    seenAccuracyM: null,
    motion: {
      nav: atPort ? 'moored' : 'underway',
      sogKn: null,
      cog: null,
      heading: null,
    },
    voyage: null,
    nextPort: {
      name: loc(destination),
      arriveAt: destination.arriveAt,
      lat: destination.lat,
      lng: destination.lng,
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
    distanceKm: !atPort ? Math.round(haversineKm(guessed.point, destination)) : null,
    offItinerary: false,
    weather: null,
    sun: sunTimes(guessed.point.lat, guessed.point.lng),
    shipTz: tzFromLongitude(guessed.point.lng),
    narrative,
    path: routePath(trip.stops),
    track: [],
    gap: [],
    forecast: forecastPath(null, guessed.point, destination, atPort),
    dataDocked: null,
    vesselsApi: null,
  }
}
