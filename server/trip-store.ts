import type { Trip } from '../shared/types.ts'
import { readJsonSync, writeJson } from './persist.ts'

let trip: Trip | null = parseTrip(readJsonSync<unknown>('trip.json', null))

export function getStoredTrip(): Trip | null {
  return trip
}

export async function saveStoredTrip(next: Trip): Promise<Trip> {
  trip = next
  await writeJson('trip.json', next)
  return next
}

export function parseTrip(value: unknown): Trip | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<Trip>
  if (typeof row.shipId !== 'string' || !row.shipId) return null
  if (typeof row.presetId !== 'string' || !row.presetId) return null
  if (typeof row.startDate !== 'string' || typeof row.endDate !== 'string') return null
  if (!Array.isArray(row.stops) || row.stops.length === 0) return null
  const stops = row.stops.filter(
    (stop) =>
      stop &&
      typeof stop.id === 'string' &&
      typeof stop.name === 'string' &&
      typeof stop.lat === 'number' &&
      typeof stop.lng === 'number' &&
      typeof stop.arriveAt === 'string' &&
      typeof stop.departAt === 'string',
  )
  if (stops.length !== row.stops.length) return null
  return {
    shipId: row.shipId,
    customShip: row.customShip,
    startDate: row.startDate,
    endDate: row.endDate,
    presetId: row.presetId,
    stops: stops.map((stop) => ({
      ...stop,
      nameDe: typeof stop.nameDe === 'string' && stop.nameDe ? stop.nameDe : stop.name,
    })),
  }
}
