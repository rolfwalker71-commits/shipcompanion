import type { Trip } from '../shared/types.ts'
import { shipById, tripKey, tripMmsi, tripShip, CUSTOM_SHIP_ID } from '../shared/ships.ts'
import { watchMmsi } from './ais.ts'
import { readJsonSync, writeJson } from './persist.ts'

type FleetFile = { ships: Trip[] }

let fleet: Trip[] = loadFleet()

function loadFleet(): Trip[] {
  const stored = readJsonSync<FleetFile | Trip[] | null>('fleet.json', null)
  const fromFleet = Array.isArray(stored) ? stored : stored?.ships
  if (Array.isArray(fromFleet) && fromFleet.length) {
    return fromFleet.map(normalizeTrip).filter((row): row is Trip => Boolean(row))
  }
  const legacy = readJsonSync<unknown>('trip.json', null)
  const trip = normalizeTrip(legacy)
  return trip ? [trip] : []
}

export function listFleet(): Trip[] {
  return fleet
}

export function getStoredTrip(): Trip | null {
  return fleet[0] ?? null
}

export function getTripById(id: string): Trip | null {
  return fleet.find((trip) => tripKey(trip) === id) ?? null
}

export function getTripByMmsi(mmsi: string): Trip | null {
  const needle = mmsi.replace(/\D/g, '')
  return fleet.find((trip) => tripMmsi(trip) === needle) ?? null
}

export async function saveFleet(next: Trip[]): Promise<Trip[]> {
  const unique = new Map<string, Trip>()
  for (const row of next) {
    const trip = normalizeTrip(row)
    if (!trip) continue
    unique.set(tripKey(trip), trip)
  }
  fleet = [...unique.values()]
  await writeJson('fleet.json', { ships: fleet })
  syncWatches()
  return fleet
}

export async function upsertTrip(next: Trip): Promise<Trip | null> {
  const trip = normalizeTrip(next)
  if (!trip) return null
  const key = tripKey(trip)
  const mmsi = tripMmsi(trip)
  const without = fleet.filter((row) => tripKey(row) !== key && tripMmsi(row) !== mmsi)
  fleet = [...without, trip]
  await writeJson('fleet.json', { ships: fleet })
  syncWatches()
  return trip
}

export async function removeTrip(id: string): Promise<boolean> {
  const before = fleet.length
  fleet = fleet.filter((trip) => tripKey(trip) !== id)
  if (fleet.length === before) return false
  await writeJson('fleet.json', { ships: fleet })
  syncWatches()
  return true
}

export async function saveStoredTrip(next: Trip): Promise<Trip> {
  const trip = await upsertTrip(next)
  if (!trip) throw new Error('invalid_trip')
  return trip
}

export function parseTrip(value: unknown): Trip | null {
  return normalizeTrip(value)
}

export function syncWatches(): void {
  for (const trip of fleet) {
    const ship = tripShip(trip)
    if (ship?.mmsi) watchMmsi(ship.mmsi, trip.stops)
  }
}

export function normalizeTrip(value: unknown): Trip | null {
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

  let customShip = row.customShip
  if (customShip) {
    const mmsi = typeof customShip.mmsi === 'string' ? customShip.mmsi.replace(/\D/g, '') : ''
    const name = typeof customShip.name === 'string' ? customShip.name.trim() : ''
    if (!mmsi || !name) customShip = undefined
    else {
      customShip = {
        name,
        mmsi,
        imo: typeof customShip.imo === 'string' ? customShip.imo.replace(/\D/g, '') : undefined,
        line: customShip.line || 'Custom',
        lineDe: customShip.lineDe || customShip.line || 'Eigene Angabe',
      }
    }
  }

  const catalog = row.shipId === CUSTOM_SHIP_ID ? undefined : shipById(row.shipId)
  const mmsiOverride = typeof row.mmsi === 'string' ? row.mmsi.replace(/\D/g, '') : ''
  const imoOverride = typeof row.imo === 'string' ? row.imo.replace(/\D/g, '') : ''
  const mmsi = mmsiOverride || customShip?.mmsi || catalog?.mmsi || ''
  const imo = imoOverride || customShip?.imo || catalog?.imo || ''
  const id =
    typeof row.id === 'string' && row.id.trim()
      ? row.id.trim()
      : mmsi || row.shipId

  return {
    id,
    shipId: row.shipId,
    mmsi: mmsi || undefined,
    imo: imo || undefined,
    customShip,
    startDate: row.startDate,
    endDate: row.endDate,
    presetId: row.presetId,
    stops: stops.map((stop) => ({
      ...stop,
      nameDe: typeof stop.nameDe === 'string' && stop.nameDe ? stop.nameDe : stop.name,
    })),
  }
}
