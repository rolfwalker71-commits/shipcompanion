import type { Trip } from '@shared/types.ts'
import { presetById } from '@shared/itineraries.ts'

const KEY = 'cruise-trip'

export function loadTrip(): Trip | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Trip
    if (!parsed.shipId || !parsed.stops?.length) return null
    const migrated = migrateTrip(parsed)
    if (migrated !== parsed) saveTrip(migrated)
    return migrated
  } catch {
    return null
  }
}

export function saveTrip(trip: Trip): void {
  localStorage.setItem(KEY, JSON.stringify(trip))
}

export function clearTrip(): void {
  localStorage.removeItem(KEY)
}

function migrateTrip(trip: Trip): Trip {
  if (trip.presetId !== 'west-med') return trip
  if (trip.stops.some((stop) => stop.id === 'la-spezia')) return trip
  const preset = presetById('west-med')
  if (!preset) return trip
  return {
    ...trip,
    startDate: preset.stops[0].arriveAt.slice(0, 10),
    endDate: preset.stops[preset.stops.length - 1].departAt.slice(0, 10),
    stops: preset.stops,
  }
}
