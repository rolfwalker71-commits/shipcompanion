import { armSkipNextDockedFetch } from './datadocked.ts'
import { readJsonSync, writeJson } from './persist.ts'

/** Display / last-known window for onboard GPS. Must not gate Data Docked fetches. */
export const MANUAL_LIVE_MS = 6 * 60 * 60 * 1000
const RATE_LIMIT_MS = 5 * 60 * 1000
const MAX_ACCURACY_M = 5000
const MAX_POSTED_BY = 80
const MAX_ROUTE_POINTS = 500
const MAX_ARCHIVES = 50
const MAX_ARCHIVE_NAME = 120

export type ManualFix = {
  lat: number
  lng: number
  ts: number
  accuracyM: number | null
  postedBy: string | null
}

export type RoutePoint = {
  lat: number
  lng: number
  ts: number
  accuracyM: number | null
  postedBy: string | null
}

export type RouteArchive = {
  id: string
  name: string | null
  createdAt: number
  points: RoutePoint[]
}

export type SaveManualResult =
  | { ok: true; fix: ManualFix }
  | { ok: false; error: 'invalid_coords' | 'invalid_accuracy' | 'too_soon' }

let store = readStored()
let activeRoute: RoutePoint[] = readJsonSync<RoutePoint[]>('manual-position-route.json', [])
let archives: RouteArchive[] = readJsonSync<RouteArchive[]>('manual-position-archive.json', [])

function readStored(): ManualFix | null {
  const raw = readJsonSync<ManualFix | null>('manual-position.json', null)
  if (!raw || typeof raw !== 'object') return null
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng) || !Number.isFinite(raw.ts)) return null
  return {
    lat: raw.lat,
    lng: raw.lng,
    ts: raw.ts,
    accuracyM: Number.isFinite(raw.accuracyM) ? raw.accuracyM : null,
    postedBy: typeof raw.postedBy === 'string' && raw.postedBy.trim() ? raw.postedBy.trim() : null,
  }
}

function persist(): void {
  void writeJson('manual-position.json', store)
}

function persistRoute(): void {
  void writeJson('manual-position-route.json', activeRoute)
}

function persistArchives(): void {
  void writeJson('manual-position-archive.json', archives)
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, maxLen)
  return trimmed || null
}

export function lastManualFix(): ManualFix | null {
  return store
}

export function manualIsFresh(fix: ManualFix | null = store, now = Date.now()): boolean {
  return Boolean(fix && now - fix.ts < MANUAL_LIVE_MS)
}

export function getActiveRoute(): RoutePoint[] {
  return activeRoute
}

export function getArchives(): Omit<RouteArchive, 'points'>[] {
  return archives.map(({ id, name, createdAt, points }) => ({
    id,
    name,
    createdAt,
    pointCount: points.length,
    startAt: points[0]?.ts ?? null,
    endAt: points.at(-1)?.ts ?? null,
  })) as unknown as Omit<RouteArchive, 'points'>[]
}

export function getArchiveById(id: string): RouteArchive | null {
  return archives.find((a) => a.id === id) ?? null
}

export function archiveActiveRoute(name: unknown): { ok: true; archive: RouteArchive } | { ok: false; error: string } {
  if (activeRoute.length === 0) return { ok: false, error: 'empty_route' }
  const archive: RouteArchive = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: cleanText(name, MAX_ARCHIVE_NAME),
    createdAt: Date.now(),
    points: [...activeRoute],
  }
  archives = [archive, ...archives].slice(0, MAX_ARCHIVES)
  persistArchives()
  activeRoute = []
  persistRoute()
  return { ok: true, archive }
}

export function saveManualFix(input: {
  lat?: unknown
  lng?: unknown
  accuracyM?: unknown
  postedBy?: unknown
}): SaveManualResult {
  const lat = Number(input.lat)
  const lng = Number(input.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: 'invalid_coords' }
  }

  let accuracyM: number | null = null
  if (input.accuracyM != null && input.accuracyM !== '') {
    const acc = Number(input.accuracyM)
    if (!Number.isFinite(acc) || acc < 0 || acc > MAX_ACCURACY_M) {
      return { ok: false, error: 'invalid_accuracy' }
    }
    accuracyM = acc
  }

  const now = Date.now()
  if (store && now - store.ts < RATE_LIMIT_MS) {
    return { ok: false, error: 'too_soon' }
  }

  const postedBy = cleanText(input.postedBy, MAX_POSTED_BY)
  store = { lat, lng, ts: now, accuracyM, postedBy }
  persist()

  const point: RoutePoint = { lat, lng, ts: now, accuracyM, postedBy }
  activeRoute = [...activeRoute, point].slice(-MAX_ROUTE_POINTS)
  persistRoute()

  armSkipNextDockedFetch()
  return { ok: true, fix: store }
}

export function clearManualFix(): boolean {
  const had = Boolean(store)
  store = null
  persist()
  return had
}

export function publicManualFix(fix: ManualFix | null = store) {
  if (!fix) return null
  return {
    lat: fix.lat,
    lng: fix.lng,
    at: new Date(fix.ts).toISOString(),
    accuracyM: fix.accuracyM,
    postedBy: fix.postedBy,
  }
}
