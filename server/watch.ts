import type { SnapshotResponse, TimelineEvent, TrackingStatus } from '../shared/types.ts'
import { tripShip } from '../shared/ships.ts'
import { getStoredTrip } from './trip-store.ts'
import { buildSnapshot } from './snapshot.ts'
import { addTimelineEvent, recentlyLogged } from './timeline.ts'
import { notifyFamily } from './push.ts'
import { readJsonSync, writeJson } from './persist.ts'

type WatchState = {
  atPort: boolean
  portName: string
  tracking: TrackingStatus
  distanceKm: number | null
  seenSource?: 'ais' | 'datadocked' | 'manual' | null
}

let timer: ReturnType<typeof setInterval> | null = null
let previous = readJsonSync<WatchState | null>('watch-state.json', null)

export function startTripWatch(): void {
  if (timer) clearInterval(timer)
  const trip = getStoredTrip()
  if (!trip) return
  void tick()
  timer = setInterval(() => void tick(), 60_000)
}

async function tick(): Promise<void> {
  const trip = getStoredTrip()
  const ship = trip ? tripShip(trip) : undefined
  if (!trip || !ship) return
  const snapshot = await buildSnapshot({
    mmsi: ship.mmsi,
    imo: ship.imo || undefined,
    shipName: ship.name,
    locale: 'de',
    stops: trip.stops,
  })
  if ('error' in snapshot) return
  const next: WatchState = {
    atPort: snapshot.nextPort.atPort,
    portName: snapshot.nextPort.berthName ?? snapshot.nextPort.name,
    tracking: snapshot.tracking,
    distanceKm: snapshot.distanceKm,
    seenSource: snapshot.seenSource,
  }
  const events = diffWatch(previous, next, snapshot)
  previous = next
  await writeJson('watch-state.json', next)
  for (const event of events) {
    await addTimelineEvent(event)
    await notifyFamily(event.titleDe, event.detailDe ?? event.titleDe, '/', `cruise-${event.kind}`)
  }
}

function diffWatch(prev: WatchState | null, next: WatchState, snapshot: SnapshotResponse): Omit<TimelineEvent, 'id' | 'at'>[] {
  const ship = snapshot.narrative.split('.')[0] || 'Schiff'
  const events: Omit<TimelineEvent, 'id' | 'at'>[] = []
  if (prev?.atPort && !next.atPort) {
    const from = snapshot.fromPort ?? prev.portName
    events.push({
      kind: 'departed',
      titleDe: `Unterwegs, aus ${from}`,
      titleEn: `Under way, left ${from}`,
      detailDe: snapshot.narrative,
      detailEn: snapshot.narrative,
    })
  }
  if (prev && !prev.atPort && next.atPort) {
    events.push({
      kind: 'arrived',
      titleDe: `Angekommen in ${next.portName}`,
      titleEn: `Arrived in ${next.portName}`,
      detailDe: snapshot.narrative,
      detailEn: snapshot.narrative,
    })
  }
  if (
    !next.atPort &&
    next.distanceKm != null &&
    next.distanceKm <= 80 &&
    (prev?.distanceKm == null || prev.distanceKm > 80) &&
    !recentlyLogged('approaching', 6 * 60 * 60 * 1000)
  ) {
    events.push({
      kind: 'approaching',
      titleDe: `Bald ${snapshot.nextPort.name} · noch ${next.distanceKm} km`,
      titleEn: `Approaching ${snapshot.nextPort.name} · ${next.distanceKm} km to go`,
      detailDe: snapshot.narrative,
      detailEn: snapshot.narrative,
    })
  }
  if (
    prev?.tracking === 'live' &&
    (next.tracking === 'last-known' || next.tracking === 'estimated') &&
    !recentlyLogged('ais-gap', 2 * 60 * 60 * 1000)
  ) {
    events.push({
      kind: 'ais-gap',
      titleDe: 'AIS-Funk ist gerade still',
      titleEn: 'AIS signal went quiet',
      detailDe: 'Die Karte schreibt Position aus dem letzten Funk grob fort.',
      detailEn: 'The map dead-reckons from the last received radio.',
    })
  }
  if (
    prev?.seenSource &&
    prev.seenSource !== 'datadocked' &&
    next.seenSource === 'datadocked' &&
    !recentlyLogged('docked-back', 2 * 60 * 60 * 1000)
  ) {
    const sat = snapshot.dataDocked?.source === 'SAT'
    events.push({
      kind: 'docked-back',
      titleDe: sat ? 'Satellitenposition von Data Docked' : 'Neue Position von Data Docked',
      titleEn: sat ? 'Satellite position from Data Docked' : 'New position from Data Docked',
      detailDe: ship,
      detailEn: ship,
    })
  }
  const aisReturned =
    next.seenSource === 'ais' &&
    (((prev?.tracking === 'last-known' || prev?.tracking === 'estimated') && next.tracking === 'live') ||
      prev?.seenSource === 'datadocked' ||
      prev?.seenSource === 'manual')
  if (aisReturned && !recentlyLogged('ais-back', 2 * 60 * 60 * 1000)) {
    events.push({
      kind: 'ais-back',
      titleDe: 'AIS ist wieder da',
      titleEn: 'AIS is back',
      detailDe: ship,
      detailEn: ship,
    })
  }
  return events
}
