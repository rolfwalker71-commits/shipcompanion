import type { SnapshotResponse, TimelineEvent, TrackingStatus } from '../shared/types.ts'
import { tripMmsi, tripShip } from '../shared/ships.ts'
import { listFleet } from './fleet-store.ts'
import { buildSnapshot } from './snapshot.ts'
import { addTimelineEvent, recentlyLogged } from './timeline.ts'
import { notifyFamily } from './push.ts'
import { readJsonSync, writeJson } from './persist.ts'

type WatchState = {
  atPort: boolean
  portName: string
  tracking: TrackingStatus
  distanceKm: number | null
  seenSource?: SnapshotResponse['seenSource']
}

let timer: ReturnType<typeof setInterval> | null = null
let previous = loadWatchMap()

function loadWatchMap(): Record<string, WatchState> {
  const raw = readJsonSync<Record<string, WatchState> | WatchState | null>('watch-state.json', null)
  if (!raw || typeof raw !== 'object') return {}
  if ('atPort' in raw && 'tracking' in raw) {
    const trip = listFleet()[0]
    const mmsi = trip ? tripMmsi(trip) : ''
    return mmsi ? { [mmsi]: raw as WatchState } : {}
  }
  return raw as Record<string, WatchState>
}

export function startTripWatch(): void {
  if (timer) clearInterval(timer)
  if (!listFleet().length) return
  void tick()
  timer = setInterval(() => void tick(), 60_000)
}

async function tick(): Promise<void> {
  const nextMap: Record<string, WatchState> = { ...previous }
  for (const trip of listFleet()) {
    const ship = tripShip(trip)
    if (!ship) continue
    const snapshot = await buildSnapshot({
      mmsi: ship.mmsi,
      imo: ship.imo || undefined,
      shipName: ship.name,
      locale: 'de',
      stops: trip.stops,
    })
    if ('error' in snapshot) continue
    const next: WatchState = {
      atPort: snapshot.nextPort.atPort,
      portName: snapshot.nextPort.berthName ?? snapshot.nextPort.name,
      tracking: snapshot.tracking,
      distanceKm: snapshot.distanceKm,
      seenSource: snapshot.seenSource,
    }
    const events = diffWatch(previous[ship.mmsi] ?? null, next, snapshot, ship.mmsi, ship.name)
    nextMap[ship.mmsi] = next
    for (const event of events) {
      await addTimelineEvent({ ...event, mmsi: ship.mmsi, shipName: ship.name })
      await notifyFamily(event.titleDe, event.detailDe ?? event.titleDe, '/', `cruise-${event.kind}`)
    }
  }
  previous = nextMap
  await writeJson('watch-state.json', nextMap)
}

function diffWatch(
  prev: WatchState | null,
  next: WatchState,
  snapshot: SnapshotResponse,
  mmsi: string,
  shipName: string,
): Omit<TimelineEvent, 'id' | 'at'>[] {
  const ship = shipName || snapshot.narrative.split('.')[0] || 'Schiff'
  const events: Omit<TimelineEvent, 'id' | 'at'>[] = []
  if (prev?.atPort && !next.atPort) {
    const from = snapshot.fromPort ?? prev.portName
    events.push({
      kind: 'departed',
      titleDe: `${ship}: unterwegs, aus ${from}`,
      titleEn: `${ship}: under way, left ${from}`,
      detailDe: snapshot.narrative,
      detailEn: snapshot.narrative,
    })
  }
  if (prev && !prev.atPort && next.atPort) {
    events.push({
      kind: 'arrived',
      titleDe: `${ship}: angekommen in ${next.portName}`,
      titleEn: `${ship}: arrived in ${next.portName}`,
      detailDe: snapshot.narrative,
      detailEn: snapshot.narrative,
    })
  }
  if (
    !next.atPort &&
    next.distanceKm != null &&
    next.distanceKm <= 80 &&
    (prev?.distanceKm == null || prev.distanceKm > 80) &&
    !recentlyLogged('approaching', 6 * 60 * 60 * 1000, mmsi)
  ) {
    events.push({
      kind: 'approaching',
      titleDe: `${ship}: bald ${snapshot.nextPort.name} · noch ${next.distanceKm} km`,
      titleEn: `${ship}: approaching ${snapshot.nextPort.name} · ${next.distanceKm} km to go`,
      detailDe: snapshot.narrative,
      detailEn: snapshot.narrative,
    })
  }
  if (
    prev?.tracking === 'live' &&
    (next.tracking === 'last-known' || next.tracking === 'estimated') &&
    !recentlyLogged('ais-gap', 2 * 60 * 60 * 1000, mmsi)
  ) {
    events.push({
      kind: 'ais-gap',
      titleDe: `${ship}: Position wird älter`,
      titleEn: `${ship}: position is going stale`,
      detailDe: 'Die Karte schreibt die letzte bekannte Position grob fort.',
      detailEn: 'The map dead-reckons from the last known fix.',
    })
  }
  if (
    prev?.seenSource &&
    prev.seenSource !== 'datadocked' &&
    next.seenSource === 'datadocked' &&
    !recentlyLogged('docked-back', 2 * 60 * 60 * 1000, mmsi)
  ) {
    const sat = snapshot.dataDocked?.source === 'SAT'
    events.push({
      kind: 'docked-back',
      titleDe: sat ? `${ship}: Satellitenposition von Data Docked` : `${ship}: neue Position von Data Docked`,
      titleEn: sat ? `${ship}: satellite position from Data Docked` : `${ship}: new position from Data Docked`,
      detailDe: ship,
      detailEn: ship,
    })
  }
  const aisReturned =
    (next.seenSource === 'ais' || next.seenSource === 'vessels') &&
    (((prev?.tracking === 'last-known' || prev?.tracking === 'estimated') && next.tracking === 'live') ||
      prev?.seenSource === 'datadocked' ||
      prev?.seenSource === 'manual')
  if (aisReturned && !recentlyLogged('ais-back', 2 * 60 * 60 * 1000, mmsi)) {
    events.push({
      kind: 'ais-back',
      titleDe: next.seenSource === 'vessels' ? `${ship}: Vessels API Position` : `${ship}: AIS ist wieder da`,
      titleEn: next.seenSource === 'vessels' ? `${ship}: Vessels API position` : `${ship}: AIS is back`,
      detailDe: ship,
      detailEn: ship,
    })
  }
  return events
}
