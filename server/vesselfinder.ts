import type { VesselFinderStatus } from '../shared/types.ts'
import { readJsonSync, writeJson } from './persist.ts'

export type VesselFix = {
  lat: number
  lng: number
  ts: number
  source: 'TER' | 'SAT'
  zone: string | null
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
  expiration: string | null
  lastError: string | null
  lastMmsi: string | null
  lastFix: VesselFix | null
}

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_INTERVAL_HOURS = 3
const DEFAULT_MONTHLY_LIMIT = 150
const STATUS_MAX_AGE_MS = 24 * HOUR_MS

let store = readJsonSync<Store>('vesselfinder.json', emptyStore())
let inflight: Promise<VesselFix | null> | null = null
let startupFetchPending = true

function apiKey(): string {
  return process.env.VESSELFINDER_API_KEY?.trim() ?? ''
}

function monthlyLimit(): number {
  const raw = Number(process.env.VESSELFINDER_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MONTHLY_LIMIT
}

function intervalMs(): number {
  const raw = Number(process.env.VESSELFINDER_MIN_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS)
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
    expiration: null,
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
    expiration: store.expiration,
    lastFix: store.lastFix,
    lastMmsi: store.lastMmsi,
  }
}

function persist(): void {
  void writeJson('vesselfinder.json', store)
}

function remainingCalls(): number {
  return Math.max(0, monthlyLimit() - store.used)
}

function nextFetchTs(): number | null {
  if (!apiKey()) return null
  if (remainingCalls() <= 0) return nextMonthTs()
  if (!store.lastFetchAt) return Date.now()
  return store.lastFetchAt + intervalMs()
}

function nextMonthTs(): number {
  const [year, month] = billingMonth().split('-').map(Number)
  const firstNext = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  return firstNext.getTime()
}

export function vesselFinderConfigured(): boolean {
  return apiKey().length > 0
}

export function vesselFinderError(_mmsi?: string): string | null {
  return store.lastError
}

export function lastVesselFinderFix(_mmsi?: string): VesselFix | null {
  return store.lastFix
}

export function vesselFinderStatus(): VesselFinderStatus {
  rollMonth()
  if (vesselFinderConfigured() && !store.lastStatusAt) void refreshStatus()
  const next = nextFetchTs()
  return {
    configured: vesselFinderConfigured(),
    usedThisMonth: store.used,
    monthlyLimit: monthlyLimit(),
    remaining: remainingCalls(),
    credits: store.credits,
    expiration: store.expiration,
    lastFetchAt: store.lastFetchAt ? new Date(store.lastFetchAt).toISOString() : null,
    nextFetchAt: next ? new Date(next).toISOString() : null,
    lastError: store.lastError,
    lastSource: store.lastFix?.source ?? null,
  }
}

/** Spend a credit only when coastal AIS is stale and the 3h / monthly budget allows it. */
export async function refreshVesselFinderIfNeeded(
  mmsi: string,
  imo: string | undefined,
  aisFresh: boolean,
): Promise<VesselFix | null> {
  if (!apiKey() || !mmsi) return store.lastFix
  rollMonth()
  if (aisFresh) return store.lastFix
  if (remainingCalls() <= 0) return store.lastFix
  const startup = startupFetchPending
  if (!startup && store.lastFetchAt && Date.now() - store.lastFetchAt < intervalMs()) return store.lastFix
  if (!startup && store.lastAttemptAt && Date.now() - store.lastAttemptAt < 15 * 60 * 1000) {
    return store.lastFix
  }
  if (inflight) return inflight
  startupFetchPending = false
  inflight = fetchVessel(mmsi, imo).finally(() => {
    inflight = null
  })
  return inflight
}

export async function fetchVesselFinder(mmsi: string, imo?: string): Promise<VesselFix | null> {
  return refreshVesselFinderIfNeeded(mmsi, imo, false)
}

async function fetchVessel(mmsi: string, imo?: string): Promise<VesselFix | null> {
  const key = apiKey()
  const url = new URL('https://api.vesselfinder.com/vessels')
  url.searchParams.set('userkey', key)
  url.searchParams.set('mmsi', mmsi)
  if (imo && !mmsi) url.searchParams.set('imo', imo)
  url.searchParams.set('sat', process.env.VESSELFINDER_SATELLITE === '0' ? '0' : '1')
  url.searchParams.set('errormode', '409')

  try {
    const response = await fetch(url)
    applyBalanceHeaders(response.headers)
    store.lastFetchAt = Date.now()
    store.lastAttemptAt = store.lastFetchAt
    store.used += 1
    store.lastMmsi = mmsi

    if (!response.ok) {
      const text = await response.text()
      store.lastError = text.trim() || `HTTP ${response.status}`
      persist()
      console.warn('VesselFinder error:', store.lastError)
      return store.lastFix
    }

    const data = (await response.json()) as { AIS?: Record<string, unknown> }[] | { error?: string }
    if (!Array.isArray(data)) {
      store.lastError = data.error ? String(data.error) : 'invalid_response'
      persist()
      return store.lastFix
    }

    const fix = parseFix(data[0]?.AIS)
    store.lastError = null
    if (fix) {
      store.lastFix = fix
      console.log(
        `VesselFinder ${fix.source} ${new Date(fix.ts).toISOString()} ${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}`,
      )
    }
    persist()
    if (!store.lastStatusAt || Date.now() - store.lastStatusAt > STATUS_MAX_AGE_MS) {
      void refreshStatus()
    }
    return store.lastFix
  } catch (error) {
    store.lastAttemptAt = Date.now()
    store.lastError = error instanceof Error ? error.message : 'network_error'
    persist()
    console.warn('VesselFinder error:', store.lastError)
    return store.lastFix
  }
}

async function refreshStatus(): Promise<void> {
  const key = apiKey()
  if (!key) return
  try {
    const url = new URL('https://api.vesselfinder.com/status')
    url.searchParams.set('userkey', key)
    const response = await fetch(url)
    applyBalanceHeaders(response.headers)
    store.lastStatusAt = Date.now()
    if (!response.ok) {
      persist()
      return
    }
    const data = (await response.json()) as { CREDITS?: number; EXPIRATION_DATE?: string; error?: string }
    if (typeof data.CREDITS === 'number' && Number.isFinite(data.CREDITS)) {
      store.credits = data.CREDITS
    }
    if (typeof data.EXPIRATION_DATE === 'string' && data.EXPIRATION_DATE.trim()) {
      store.expiration = data.EXPIRATION_DATE.trim()
    }
    persist()
  } catch {
    store.lastStatusAt = Date.now()
    persist()
  }
}

function applyBalanceHeaders(headers: Headers): void {
  const balance = Number(headers.get('x-api-balance-new'))
  if (Number.isFinite(balance)) store.credits = balance
  const expiration = headers.get('x-api-expiration-date')
  if (expiration) store.expiration = expiration
}

function parseFix(ais: Record<string, unknown> | undefined): VesselFix | null {
  if (!ais) return null
  const lat = Number(ais.LATITUDE)
  const lng = Number(ais.LONGITUDE)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const headingRaw = Number(ais.HEADING)
  const heading = Number.isFinite(headingRaw) && headingRaw !== 511 ? headingRaw : null
  const sogRaw = Number(ais.SPEED)
  const cogRaw = Number(ais.COURSE)
  const navRaw = Number(ais.NAVSTAT)
  return {
    lat,
    lng,
    ts: parseUtc(ais.TIMESTAMP) ?? Date.now(),
    source: ais.SRC === 'SAT' ? 'SAT' : 'TER',
    zone: typeof ais.ZONE === 'string' && ais.ZONE ? ais.ZONE : null,
    destination: typeof ais.DESTINATION === 'string' && ais.DESTINATION.trim() ? ais.DESTINATION.trim() : null,
    eta: parseEta(ais.ETA),
    sog: Number.isFinite(sogRaw) && sogRaw >= 0 && sogRaw < 80 ? sogRaw : null,
    cog: Number.isFinite(cogRaw) ? cogRaw : null,
    heading,
    navStatus: Number.isFinite(navRaw) ? navRaw : null,
  }
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
  const stamp = Date.parse(normalized)
  return Number.isFinite(stamp) ? stamp : null
}

function parseEta(value: unknown): string | null {
  const ts = parseUtc(value)
  return ts ? new Date(ts).toISOString() : null
}

rollMonth()
