import { randomBytes } from 'node:crypto'
import type { TimelineEvent } from '../shared/types.ts'
import { readJsonSync, writeJson } from './persist.ts'

const MAX_EVENTS = 80

let events = readJsonSync<TimelineEvent[]>('timeline.json', []).filter(
  (row) => row?.id && row.kind && row.at && row.titleDe && row.titleEn,
)

export function listTimeline(mmsi?: string): TimelineEvent[] {
  const rows = mmsi
    ? events.filter((row) => !row.mmsi || row.mmsi === mmsi)
    : events
  return [...rows].sort((a, b) => (a.at < b.at ? 1 : -1))
}

export async function addTimelineEvent(
  event: Omit<TimelineEvent, 'id' | 'at'> & { at?: string; id?: string },
): Promise<TimelineEvent> {
  const next: TimelineEvent = {
    id: event.id ?? randomBytes(8).toString('hex'),
    at: event.at ?? new Date().toISOString(),
    kind: event.kind,
    titleDe: event.titleDe,
    titleEn: event.titleEn,
    detailDe: event.detailDe,
    detailEn: event.detailEn,
    mmsi: event.mmsi,
    shipName: event.shipName,
  }
  events = [next, ...events.filter((row) => row.id !== next.id)].slice(0, MAX_EVENTS)
  await writeJson('timeline.json', events)
  return next
}

export function recentlyLogged(kind: TimelineEvent['kind'], windowMs: number, mmsi?: string): boolean {
  const since = Date.now() - windowMs
  return events.some(
    (row) =>
      row.kind === kind &&
      new Date(row.at).getTime() >= since &&
      (!mmsi || !row.mmsi || row.mmsi === mmsi),
  )
}
