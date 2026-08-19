import type { DataDockedStatus } from '../shared/types.ts'
import { readJsonSync, writeJson } from './persist.ts'

export type DockedFix = {
  lat: number
  lng: number
  ts: number
  source: 'TER' | 'SAT'
  destination: string | null
  eta: string | null
  sog: number | null
  cog: number | null
  heading: number | null
  navStatus: number | null
}

type Store = {
  month: string
  used: number
  lastFetchAt: number | null
  lastAttemptAt: number | null
  lastStatusAt: number | null
  credits: number | null
  lastError: string | null
  lastMmsi: string | null
  lastFix: DockedFix | null
  intervalHours: number | null
}

const BASE = 'https://datadocked.com/api/vessels_operations'
const HOUR_MS = 60 * 60 * 1000
const DEFAULT_INTERVAL_HOURS = 3
const DEFAULT_MONTHLY_LIMIT = 250

let store = readJsonSync<Store>('datadocked.json', emptyStore())
type FetchOutcome =
  | { kind: 'ok'; fix: DockedFix }
  | { kind: 'no_position' }
  | { kind: 'error'; message: string }

export type ForceRefreshError = 'not_configured' | 'no_credits' | 'no_mmsi' | 'no_position' | 'fetch_failed'

export type ForceRefreshResult =
  | { ok: true; fix: DockedFix; status: DataDockedStatus }
  | { ok: false; error: ForceRefreshError; status: DataDockedStatus }

let inflight: Promise<FetchOutcome> | null = null
let startupFetchPending = true
let gapFetchAt: number | null = null
let lastFailAt: number | null = null
const FAIL_BACKOFF_MS = 5 * 60 * 1000

function apiKey(): string {
  return process.env.DATADOCKED_API_KEY?.trim() ?? ''
}

function monthlyLimit(): number {
  const raw = Number(process.env.DATADOCKED_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MONTHLY_LIMIT
}

const ALLOWED_INTERVALS = [1, 3] as const

function envIntervalHours(): number {
  const raw = Number(process.env.DATADOCKED_MIN_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS)
  return Number.isFinite(raw) && raw >= 1 ? Math.min(24, Math.floor(raw)) : DEFAULT_INTERVAL_HOURS
}

export function intervalHours(): number {
  const override = store.intervalHours
  if (override === 1 || override === 3) return override
  return envIntervalHours()
}

function intervalMs(): number {
  return intervalHours() * HOUR_MS
}

function billingMonth(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
  }).format(now)
}

function emptyStore(): Store {
  return {
    month: billingMonth(),
    used: 0,
    lastFetchAt: null,
    lastAttemptAt: null,
    lastStatusAt: null,
    credits: null,
    lastError: null,
    lastMmsi: null,
    lastFix: null,
    intervalHours: null,
  }
}

function rollMonth(): void {
  const month = billingMonth()
  if (store.month === month) return
  store = {
    ...emptyStore(),
    month,
    credits: store.credits,
    lastFix: store.lastFix,
    lastMmsi: store.lastMmsi,
    intervalHours: store.intervalHours,
  }
}

function persist(): void {
  void writeJson('datadocked.json', store)
}

function remainingLocal(): number {
  return Math.max(0, monthlyLimit() - store.used)
}

function nextFetchTs(): number | null {
  if (!apiKey()) return null
  if (remainingLocal() <= 0) return nextMonthTs()
  if (store.credits === 0) return null
  if (!store.lastFetchAt) return Date.now()
  return store.lastFetchAt + intervalMs()
}

function nextMonthTs(): number {
  const [year, month] = billingMonth().split('-').map(Number)
  const firstNext = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  return firstNext.getTime()
}

export function dataDockedConfigured(): boolean {
  return apiKey().length > 0
}

export function dataDockedError(): string | null {
  return store.lastError
}

export function lastDataDockedFix(): DockedFix | null {
  return store.lastFix
}

export function dataDockedStatus(): DataDockedStatus {
  rollMonth()
  if (dataDockedConfigured() && !store.lastStatusAt) void refreshCredits()
  const next = nextFetchTs()
  return {
    configured: dataDockedConfigured(),
    usedThisMonth: store.used,
    monthlyLimit: monthlyLimit(),
    remaining: remainingLocal(),
    credits: store.credits,
    lastFetchAt: store.lastFetchAt ? new Date(store.lastFetchAt).toISOString() : null,
    nextFetchAt: next ? new Date(next).toISOString() : null,
    lastError: store.lastError,
    lastSource: store.lastFix?.source ?? null,
    intervalHours: intervalHours(),
    pinConfigured: settingsPinConfigured(),
  }
}

export function settingsPinConfigured(): boolean {
  return Boolean(process.env.SETTINGS_PIN?.trim())
}

export function setIntervalHours(hours: number): boolean {
  if (!(ALLOWED_INTERVALS as readonly number[]).includes(hours)) return false
  store.intervalHours = hours
  persist()
  return true
}

function apiHeaders(): { accept: string; 'x-api-key': string } {
  return { accept: 'application/json', 'x-api-key': apiKey() }
}

/** Spend a credit only when coastal AIS is quiet. Never burn credits while AIS is fresh. */
export async function refreshDataDockedIfNeeded(mmsi: string, aisFresh: boolean): Promise<DockedFix | null> {
  if (!apiKey() || !mmsi) return store.lastFix
  rollMonth()
  if (store.credits == null) {
    await refreshCredits().catch(() => {})
  }
  if (aisFresh) {
    gapFetchAt = null
    startupFetchPending = false
    return store.lastFix
  }
  if (remainingLocal() <= 0) return store.lastFix
  if (store.credits === 0) return store.lastFix
  if (lastFailAt && Date.now() - lastFailAt < FAIL_BACKOFF_MS) return store.lastFix
  // First quiet-AIS check after boot may fetch once; after that respect the interval.
  if (!startupFetchPending && gapFetchAt && Date.now() - gapFetchAt < intervalMs()) {
    return store.lastFix
  }
  if (inflight) {
    await inflight
    return store.lastFix
  }
  startupFetchPending = false
  inflight = fetchLocation(mmsi).finally(() => {
    inflight = null
  })
  await inflight
  return store.lastFix
}

/** Admin fetch: ignore AIS freshness, interval, and failure backoff. Still spends a credit. */
export async function forceRefreshDataDocked(mmsi: string): Promise<ForceRefreshResult> {
  rollMonth()
  if (!apiKey()) return { ok: false, error: 'not_configured', status: dataDockedStatus() }
  if (!mmsi) return { ok: false, error: 'no_mmsi', status: dataDockedStatus() }
  if (store.credits == null) {
    await refreshCredits().catch(() => {})
  }
  if (remainingLocal() <= 0 || store.credits === 0) {
    return { ok: false, error: 'no_credits', status: dataDockedStatus() }
  }
  if (inflight) {
    const pending = await inflight
    if (pending.kind === 'ok') return { ok: true, fix: pending.fix, status: dataDockedStatus() }
    if (remainingLocal() <= 0 || store.credits === 0) {
      return { ok: false, error: 'no_credits', status: dataDockedStatus() }
    }
  }
  lastFailAt = null
  inflight = fetchLocation(mmsi).finally(() => {
    inflight = null
  })
  const outcome = await inflight
  if (outcome.kind === 'ok') return { ok: true, fix: outcome.fix, status: dataDockedStatus() }
  if (outcome.kind === 'no_position') return { ok: false, error: 'no_position', status: dataDockedStatus() }
  return { ok: false, error: 'fetch_failed', status: dataDockedStatus() }
}

async function fetchLocation(mmsi: string): Promise<FetchOutcome> {
  const url = new URL(`${BASE}/get-vessel-location`)
  url.searchParams.set('imo_or_mmsi', mmsi)

  try {
    const response = await fetch(url, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(8_000),
    })
    store.lastAttemptAt = Date.now()
    store.lastMmsi = mmsi

    if (!response.ok) {
      const text = await response.text()
      store.lastError = parseError(text) || `HTTP ${response.status}`
      lastFailAt = Date.now()
      persist()
      console.warn('Data Docked error:', store.lastError)
      return { kind: 'error', message: store.lastError }
    }

    const data: unknown = await response.json()
    const fix = parseFix(data)
    store.lastFetchAt = Date.now()
    store.used += 1
    store.lastError = fix ? null : parseMiss(data)
    if (fix) {
      store.lastFix = fix
      lastFailAt = null
      gapFetchAt = Date.now()
      console.log(
        `DataDocked ${fix.source} ${new Date(fix.ts).toISOString()} ${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}`,
      )
    } else {
      lastFailAt = Date.now()
      console.warn('Data Docked no position:', store.lastError)
    }
    persist()
    await refreshCredits().catch(() => {})
    return fix ? { kind: 'ok', fix } : { kind: 'no_position' }
  } catch (error) {
    store.lastAttemptAt = Date.now()
    store.lastError = error instanceof Error ? error.message : 'network_error'
    lastFailAt = Date.now()
    persist()
    console.warn('Data Docked error:', store.lastError)
    return { kind: 'error', message: store.lastError }
  }
}

async function refreshCredits(): Promise<void> {
  const key = apiKey()
  if (!key) return
  try {
    const response = await fetch(`${BASE}/my-credits`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(8_000),
    })
    store.lastStatusAt = Date.now()
    if (!response.ok) {
      persist()
      return
    }
    const data = (await response.json()) as { detail?: { credits?: number }; credits?: number }
    const credits = Number(data.detail?.credits ?? data.credits)
    if (Number.isFinite(credits)) store.credits = credits
    persist()
  } catch {
    store.lastStatusAt = Date.now()
    persist()
  }
}

function parseError(text: string): string | null {
  try {
    const data = JSON.parse(text) as { error?: string; message?: string; detail?: unknown }
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim()
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
    if (typeof data.detail === 'string' && data.detail.trim()) return data.detail.trim()
  } catch {
    /* raw text */
  }
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length < 240 ? trimmed : null
}

function parseMiss(data: unknown): string {
  const row = vesselRow(data)
  const keys = row ? Object.keys(row).join(',') : typeof data
  return `no_position (${keys || 'empty'})`
}

/** Live get-vessel-location returns the vessel at the root; docs/examples wrap it in `detail`. */
function vesselRow(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const row = data as Record<string, unknown>
  if (hasCoords(row)) return row
  if (row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)) {
    return row.detail as Record<string, unknown>
  }
  return row
}

function hasCoords(row: Record<string, unknown>): boolean {
  return readCoord(row.latitude) != null || readCoord(row.lat) != null
}

function readCoord(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const n = Number(value.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function parseFix(data: unknown): DockedFix | null {
  const row = vesselRow(data)
  if (!row) return null
  const lat = readCoord(row.latitude) ?? readCoord(row.lat)
  const lng = readCoord(row.longitude) ?? readCoord(row.lng) ?? readCoord(row.lon)
  if (lat == null || lng == null) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const headingRaw = readCoord(row.heading)
  const heading = headingRaw != null && headingRaw >= 0 && headingRaw < 360 ? headingRaw : null
  const cogRaw = readCoord(row.course) ?? readCoord(row.cog)
  const sogRaw = readCoord(row.speed) ?? readCoord(row.sog)
  const etaTs = parseUtc(row.etaUtc)
  return {
    lat,
    lng,
    ts: parseUtc(row.positionReceived) ?? parseUtc(row.updateTime) ?? Date.now(),
    source: parseSource(row.dataSource),
    destination: typeof row.destination === 'string' && row.destination.trim() ? row.destination.trim() : null,
    eta: etaTs ? new Date(etaTs).toISOString() : null,
    sog: sogRaw != null && sogRaw >= 0 && sogRaw < 80 ? sogRaw : null,
    cog: cogRaw != null && cogRaw >= 0 && cogRaw < 360 ? cogRaw : null,
    heading,
    navStatus: navStatusFromLabel(row.navigationalStatus),
  }
}

function parseSource(value: unknown): 'TER' | 'SAT' {
  const text = String(value ?? '').toLowerCase()
  if (text.includes('sat')) return 'SAT'
  return 'TER'
}

function navStatusFromLabel(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 15) return numeric
  const text = value.toLowerCase()
  if (text.includes('moor')) return 5
  if (text.includes('anchor')) return 1
  if (text.includes('aground')) return 6
  if (text.includes('not under command')) return 2
  if (text.includes('restricted') || text.includes('constrained') || text.includes('fishing')) return 3
  if (text.includes('sail')) return 8
  if (text.includes('under way') || text.includes('underway')) return 0
  return null
}

function parseUtc(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2}:\d{2})/, '$1T$2')
    .replace(/ UTC$/i, 'Z')
    .replace(/ (?=[+-]\d{2}:?\d{2}$)/, '')
  const stamp = Date.parse(normalized.includes('T') || /Z|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isFinite(stamp) ? stamp : null
}

rollMonth()
