import type { Trip } from '@shared/types.ts'
import { presetById } from '@shared/itineraries.ts'
import { tripKey } from '@shared/ships.ts'

const FLEET_KEY = 'cruise-fleet'
const SELECTED_KEY = 'cruise-selected-ship'
const LEGACY_KEY = 'cruise-trip'

export function loadFleet(): Trip[] {
  try {
    const raw = localStorage.getItem(FLEET_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { ships?: Trip[] } | Trip[]
      const ships = Array.isArray(parsed) ? parsed : parsed.ships
      if (Array.isArray(ships) && ships.length) return ships.map(migrateTrip)
    }
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as Trip
      if (parsed.shipId && parsed.stops?.length) return [migrateTrip(parsed)]
    }
    return []
  } catch {
    return []
  }
}

export function saveFleet(ships: Trip[]): void {
  localStorage.setItem(FLEET_KEY, JSON.stringify({ ships }))
  const selected = loadSelectedId()
  if (selected && !ships.some((trip) => tripKey(trip) === selected)) {
    saveSelectedId(ships[0] ? tripKey(ships[0]) : null)
  }
}

export function loadSelectedId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

export function saveSelectedId(id: string | null): void {
  if (!id) {
    localStorage.removeItem(SELECTED_KEY)
    return
  }
  localStorage.setItem(SELECTED_KEY, id)
}

export function pickTrip(ships: Trip[], id?: string | null): Trip | null {
  if (!ships.length) return null
  if (id) {
    const match = ships.find((trip) => tripKey(trip) === id)
    if (match) return match
  }
  return ships[0]
}

export function loadTrip(): Trip | null {
  return pickTrip(loadFleet(), loadSelectedId())
}

export function saveTrip(trip: Trip): void {
  localStorage.setItem(LEGACY_KEY, JSON.stringify(trip))
  const ships = loadFleet()
  const key = tripKey(trip)
  const next = [...ships.filter((row) => tripKey(row) !== key), trip]
  saveFleet(next)
  saveSelectedId(key)
}

export function clearTrip(): void {
  localStorage.removeItem(LEGACY_KEY)
}

export async function fetchRemoteFleet(): Promise<Trip[]> {
  const res = await fetch('/api/fleet', { credentials: 'include' })
  if (!res.ok) {
    const fallback = await fetchRemoteTrip()
    return fallback ? [fallback] : []
  }
  const data = (await res.json()) as { ships?: Trip[] }
  return Array.isArray(data.ships) ? data.ships.map(migrateTrip) : []
}

export async function fetchRemoteTrip(): Promise<Trip | null> {
  const res = await fetch('/api/trip', { credentials: 'include' })
  if (!res.ok) return null
  const data = (await res.json()) as { trip?: Trip | null }
  const trip = data.trip
  if (!trip?.shipId) return null
  return migrateTrip(trip)
}

export async function pushRemoteTrip(trip: Trip): Promise<Trip> {
  const next = migrateTrip(trip)
  const res = await fetch('/api/fleet/ships', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
  if (!res.ok) {
    const error = new Error('trip save failed') as Error & { status: number }
    error.status = res.status
    throw error
  }
  const data = (await res.json()) as { trip?: Trip; ships?: Trip[] }
  const saved = data.trip ? migrateTrip(data.trip) : next
  if (Array.isArray(data.ships)) saveFleet(data.ships.map(migrateTrip))
  else saveTrip(saved)
  saveSelectedId(tripKey(saved))
  return saved
}

export async function removeRemoteTrip(id: string): Promise<Trip[]> {
  const res = await fetch(`/api/fleet/ships/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const error = new Error('trip delete failed') as Error & { status: number }
    error.status = res.status
    throw error
  }
  const data = (await res.json()) as { ships?: Trip[] }
  const ships = Array.isArray(data.ships) ? data.ships.map(migrateTrip) : []
  saveFleet(ships)
  return ships
}

function migrateTrip(trip: Trip): Trip {
  const preset = presetById(trip.presetId)
  const withId: Trip = { ...trip, id: trip.id || tripKey(trip) }
  if (!preset || !preset.stops.length) return withId

  if (trip.presetId === 'west-med' && !trip.stops.some((stop) => stop.id === 'la-spezia')) {
    return {
      ...withId,
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
  return changed ? { ...withId, stops } : withId
}
