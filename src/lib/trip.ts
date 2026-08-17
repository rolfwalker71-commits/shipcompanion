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

export async function fetchRemoteTrip(): Promise<Trip | null> {
  const res = await fetch('/api/trip', { credentials: 'include' })
  if (!res.ok) return null
  const data = (await res.json()) as { trip?: Trip | null }
  const trip = data.trip
  if (!trip?.shipId || !trip.stops?.length) return null
  return migrateTrip(trip)
}

export async function pushRemoteTrip(trip: Trip): Promise<void> {
  const next = migrateTrip(trip)
  saveTrip(next)
  const res = await fetch('/api/trip', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
  if (!res.ok) throw new Error('trip save failed')
}

function migrateTrip(trip: Trip): Trip {
  const preset = presetById(trip.presetId)
  if (!preset) return trip

  if (trip.presetId === 'west-med' && !trip.stops.some((stop) => stop.id === 'la-spezia')) {
    return {
      ...trip,
      startDate: preset.stops[0].arriveAt.slice(0, 10),
      endDate: preset.stops[preset.stops.length - 1].departAt.slice(0, 10),
      stops: preset.stops,
    }
  }

  let changed = false
  const stops = trip.stops.map((stop) => {
    const next = preset.stops.find((item) => item.id === stop.id)
    if (!next || (next.lat === stop.lat && next.lng === stop.lng)) return stop
    changed = true
    return { ...stop, lat: next.lat, lng: next.lng }
  })
  return changed ? { ...trip, stops } : trip
}
