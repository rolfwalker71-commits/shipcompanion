import { armSkipNextDockedFetch } from './datadocked.ts'
import { readJsonSync, writeJson } from './persist.ts'

/** Display / last-known window for onboard GPS. Must not gate Data Docked fetches. */
export const MANUAL_LIVE_MS = 6 * 60 * 60 * 1000
const RATE_LIMIT_MS = 5 * 60 * 1000
const MAX_ACCURACY_M = 5000
const MAX_POSTED_BY = 80

export type ManualFix = {
  lat: number
  lng: number
  ts: number
  accuracyM: number | null
  postedBy: string | null
}

export type SaveManualResult =
  | { ok: true; fix: ManualFix }
  | { ok: false; error: 'invalid_coords' | 'invalid_accuracy' | 'too_soon' }

let store = readStored()

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

  store = {
    lat,
    lng,
    ts: now,
    accuracyM,
    postedBy: cleanText(input.postedBy, MAX_POSTED_BY),
  }
  persist()
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
