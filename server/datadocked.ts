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
}

const BASE = 'https://datadocked.com/api/vessels_operations'
const HOUR_MS = 60 * 60 * 1000
const DEFAULT_INTERVAL_HOURS = 3
const DEFAULT_MONTHLY_LIMIT = 250
const STATUS_MAX_AGE_MS = 24 * HOUR_MS

let store = readJsonSync<Store>('datadocked.json', emptyStore())
let inflight: Promise<DockedFix | null> | null = null
let startupFetchPending = true

function apiKey(): string {
  return process.env.DATADOCKED_API_KEY?.trim() ?? ''
}

function monthlyLimit(): number {
  const raw = Number(process.env.DATADOCKED_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MONTHLY_LIMIT
}

function intervalMs(): number {
  const raw = Number(process.env.DATADOCKED_MIN_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS)
  const hours = Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_INTERVAL_HOURS
  return hours * HOUR_MS
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
  }
}

/** Spend a credit only when coastal AIS is stale and the interval / budget allows it. */
export async function refreshDataDockedIfNeeded(mmsi: string, aisFresh: boolean): Promise<DockedFix | null> {
  if (!apiKey() || !mmsi) return store.lastFix
  rollMonth()
  if (aisFresh) return store.lastFix
  if (remainingLocal() <= 0) return store.lastFix
  if (store.credits === 0) return store.lastFix
  const startup = startupFetchPending
  if (!startup && store.lastFetchAt && Date.now() - store.lastFetchAt < intervalMs()) return store.lastFix
  if (!startup && store.lastAttemptAt && Date.now() - store.lastAttemptAt < 15 * 60 * 1000) {
    return store.lastFix
  }
  if (inflight) return inflight
  startupFetchPending = false
  inflight = fetchLocation(mmsi).finally(() => {
    inflight = null
  })
  return inflight
}

async function fetchLocation(mmsi: string): Promise<DockedFix | null> {
  const key = apiKey()
  const url = new URL(`${BASE}/get-vessel-location`)
  url.searchParams.set('imo_or_mmsi', mmsi)

  try {
    const response = await fetch(url, {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(8_000),
    })
    store.lastAttemptAt = Date.now()
    store.lastMmsi = mmsi

    if (!response.ok) {
      const text = await response.text()
      store.lastError = parseError(text) || `HTTP ${response.status}`
      persist()
      console.warn('Data Docked error:', store.lastError)
      return store.lastFix
    }

    const data = (await response.json()) as { detail?: unknown; error?: string; message?: string }
    const fix = parseFix(data.detail)
    store.lastFetchAt = Date.now()
    store.used += 1
    store.lastError = fix ? null : parseError(JSON.stringify(data)) || 'no_position'
    if (fix) {
      store.lastFix = fix
      console.log(
        `DataDocked ${fix.source} ${new Date(fix.ts).toISOString()} ${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}`,
      )
    }
    persist()
    if (!store.lastStatusAt || Date.now() - store.lastStatusAt > STATUS_MAX_AGE_MS) {
      void refreshCredits()
    } else {
      if (store.credits != null && store.credits > 0) store.credits = Math.max(0, store.credits - 1)
      persist()
    }
    return store.lastFix
  } catch (error) {
    store.lastAttemptAt = Date.now()
    store.lastError = error instanceof Error ? error.message : 'network_error'
    persist()
    console.warn('Data Docked error:', store.lastError)
    return store.lastFix
  }
}

async function refreshCredits(): Promise<void> {
  const key = apiKey()
  if (!key) return
  try {
    const response = await fetch(`${BASE}/my-credits`, {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(8_000),
    })
    store.lastStatusAt = Date.now()
    if (!response.ok) {
      persist()
      return
    }
    const data = (await response.json()) as { detail?: { credits?: number } }
    const credits = Number(data.detail?.credits)
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

function parseFix(detail: unknown): DockedFix | null {
  if (!detail || typeof detail !== 'object') return null
  const row = detail as Record<string, unknown>
  const lat = Number(row.latitude)
  const lng = Number(row.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const headingRaw = Number(row.heading)
  const heading = Number.isFinite(headingRaw) && headingRaw >= 0 && headingRaw < 360 ? headingRaw : null
  const cogRaw = Number(row.course)
  const sogRaw = Number(row.speed)
  const etaTs = parseUtc(row.etaUtc)
  return {
    lat,
    lng,
    ts: parseUtc(row.positionReceived) ?? parseUtc(row.updateTime) ?? Date.now(),
    source: parseSource(row.dataSource),
    destination: typeof row.destination === 'string' && row.destination.trim() ? row.destination.trim() : null,
    eta: etaTs ? new Date(etaTs).toISOString() : null,
    sog: Number.isFinite(sogRaw) && sogRaw >= 0 && sogRaw < 80 ? sogRaw : null,
    cog: Number.isFinite(cogRaw) && cogRaw >= 0 && cogRaw < 360 ? cogRaw : null,
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
