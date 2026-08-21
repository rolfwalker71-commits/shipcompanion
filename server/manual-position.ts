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

let byMmsi: Record<string, ManualFix> = readStoredMap()
let routes: Record<string, RoutePoint[]> = readRouteMap()
let archives: RouteArchive[] = readJsonSync<RouteArchive[]>('manual-position-archive.json', [])

function parseFix(raw: unknown): ManualFix | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as ManualFix
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng) || !Number.isFinite(row.ts)) return null
  return {
    lat: row.lat,
    lng: row.lng,
    ts: row.ts,
    accuracyM: Number.isFinite(row.accuracyM) ? row.accuracyM : null,
    postedBy: typeof row.postedBy === 'string' && row.postedBy.trim() ? row.postedBy.trim() : null,
  }
}

function readStoredMap(): Record<string, ManualFix> {
  const raw = readJsonSync<unknown>('manual-position.json', null)
  if (!raw || typeof raw !== 'object') return {}
  const row = raw as { byMmsi?: Record<string, unknown>; lat?: number; ts?: number }
  if (row.byMmsi && typeof row.byMmsi === 'object') {
    const next: Record<string, ManualFix> = {}
    for (const [key, value] of Object.entries(row.byMmsi)) {
      const fix = parseFix(value)
      if (fix) next[key] = fix
    }
    return next
  }
  const legacy = parseFix(raw)
  return legacy ? { '': legacy } : {}
}

function readRouteMap(): Record<string, RoutePoint[]> {
  const raw = readJsonSync<unknown>('manual-position-route.json', [])
  if (Array.isArray(raw)) return { '': raw as RoutePoint[] }
  if (raw && typeof raw === 'object') return raw as Record<string, RoutePoint[]>
  return {}
}

function persist(): void {
  void writeJson('manual-position.json', { byMmsi })
}

function persistRoute(): void {
  void writeJson('manual-position-route.json', routes)
}

function persistArchives(): void {
  void writeJson('manual-position-archive.json', archives)
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, maxLen)
  return trimmed || null
}

export function lastManualFix(mmsi?: string): ManualFix | null {
  if (mmsi) return byMmsi[mmsi] ?? byMmsi[''] ?? null
  const rows = Object.values(byMmsi)
  if (!rows.length) return null
  return rows.reduce((newest, row) => (row.ts > newest.ts ? row : newest))
}

export function manualIsFresh(fix: ManualFix | null = lastManualFix(), now = Date.now()): boolean {
  return Boolean(fix && now - fix.ts < MANUAL_LIVE_MS)
}

export function getActiveRoute(mmsi?: string): RoutePoint[] {
  if (mmsi) return routes[mmsi] ?? routes[''] ?? []
  return Object.values(routes).flat()
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

export function archiveActiveRoute(name: unknown, mmsi?: string): { ok: true; archive: RouteArchive } | { ok: false; error: string } {
  const key = mmsi || ''
  const activeRoute = routes[key] ?? []
  if (activeRoute.length === 0) return { ok: false, error: 'empty_route' }
  const archive: RouteArchive = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: cleanText(name, MAX_ARCHIVE_NAME),
    createdAt: Date.now(),
    points: [...activeRoute],
  }
  archives = [archive, ...archives].slice(0, MAX_ARCHIVES)
  persistArchives()
  routes[key] = []
  persistRoute()
  return { ok: true, archive }
}

export function saveManualFix(input: {
  lat?: unknown
  lng?: unknown
  accuracyM?: unknown
  postedBy?: unknown
  mmsi?: unknown
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

  const key = typeof input.mmsi === 'string' ? input.mmsi.replace(/\D/g, '') : ''
  const now = Date.now()
  const prev = byMmsi[key] ?? byMmsi[''] ?? null
  if (prev && now - prev.ts < RATE_LIMIT_MS) {
    return { ok: false, error: 'too_soon' }
  }

  const postedBy = cleanText(input.postedBy, MAX_POSTED_BY)
  const fix: ManualFix = { lat, lng, ts: now, accuracyM, postedBy }
  byMmsi[key || Object.keys(byMmsi)[0] || ''] = fix
  if (key) delete byMmsi['']
  persist()

  const point: RoutePoint = { lat, lng, ts: now, accuracyM, postedBy }
  const routeKey = key || ''
  routes[routeKey] = [...(routes[routeKey] ?? []), point].slice(-MAX_ROUTE_POINTS)
  persistRoute()

  armSkipNextDockedFetch()
  return { ok: true, fix }
}

export function clearManualFix(mmsi?: string): boolean {
  const key = mmsi?.replace(/\D/g, '') ?? ''
  if (key && byMmsi[key]) {
    delete byMmsi[key]
    persist()
    return true
  }
  if (!key && Object.keys(byMmsi).length) {
    byMmsi = {}
    persist()
    return true
  }
  return false
}

export function publicManualFix(mmsi?: string) {
  const fix = lastManualFix(mmsi)
  if (!fix) return null
  return {
    lat: fix.lat,
    lng: fix.lng,
    at: new Date(fix.ts).toISOString(),
    accuracyM: fix.accuracyM,
    postedBy: fix.postedBy,
  }
}
