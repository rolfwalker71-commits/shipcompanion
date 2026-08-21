import type { VesselsApiStatus } from '../shared/types.ts'
import { tripShip } from '../shared/ships.ts'
import { listFleet } from './fleet-store.ts'
import { ingestFix, ingestHistory, rememberVoyage, type LiveFix } from './ais.ts'
import { readJsonSync, writeJson } from './persist.ts'

function pinConfigured(): boolean {
  return Boolean(process.env.SETTINGS_PIN?.trim())
}

export type VesselsFix = LiveFix & {
  destination: string | null
  eta: string | null
  name: string | null
}

type Store = {
  lastFetchAt: number | null
  lastAttemptAt: number | null
  lastError: string | null
  intervalMinutes: number | null
  fixes: Record<string, VesselsFix>
  historyAt: Record<string, number>
  historySeeded: Record<string, boolean>
  lastHistoryAt: number | null
  lastHistoryError: string | null
}

const BASE = 'https://vessels-api.com/api/V1'
const DEFAULT_INTERVAL_MINUTES = 30
const ALLOWED_INTERVALS = [30, 60] as const
const MINUTE_MS = 60 * 1000
const FAIL_BACKOFF_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_DAILY_HOURS = 30
const HISTORY_SEED_HOURS = 168

let store = migrateStore(readJsonSync<Store>('vessels-api.json', emptyStore()))
let inflight: Promise<void> | null = null
let historyInflight: Promise<void> | null = null
let lastFailAt: number | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function emptyStore(): Store {
  return {
    lastFetchAt: null,
    lastAttemptAt: null,
    lastError: null,
    intervalMinutes: null,
    fixes: {},
    historyAt: {},
    historySeeded: {},
    lastHistoryAt: null,
    lastHistoryError: null,
  }
}

function migrateStore(raw: Store): Store {
  return {
    ...emptyStore(),
    ...raw,
    fixes: raw.fixes && typeof raw.fixes === 'object' ? raw.fixes : {},
    historyAt: raw.historyAt && typeof raw.historyAt === 'object' ? raw.historyAt : {},
    historySeeded: raw.historySeeded && typeof raw.historySeeded === 'object' ? raw.historySeeded : {},
  }
}

function apiKey(): string {
  return process.env.VESSELS_API_KEY?.trim() ?? ''
}

function envIntervalMinutes(): number {
  const raw = Number(process.env.VESSELS_API_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES)
  if (!Number.isFinite(raw)) return DEFAULT_INTERVAL_MINUTES
  if ((ALLOWED_INTERVALS as readonly number[]).includes(Math.floor(raw))) return Math.floor(raw)
  if (raw >= 15 && raw <= 120) return Math.floor(raw)
  return DEFAULT_INTERVAL_MINUTES
}

export function vesselsIntervalMinutes(): number {
  const override = store.intervalMinutes
  if ((ALLOWED_INTERVALS as readonly number[]).includes(override as number)) return override as number
  return envIntervalMinutes()
}

export function vesselsLiveMs(): number {
  return vesselsIntervalMinutes() * MINUTE_MS + 15 * MINUTE_MS
}

function persist(): void {
  void writeJson('vessels-api.json', store)
}

export function vesselsConfigured(): boolean {
  return apiKey().length > 0
}

export function lastVesselsFix(mmsi: string): VesselsFix | null {
  return store.fixes[mmsi] ?? null
}

export function setVesselsIntervalMinutes(minutes: number): boolean {
  if (!(ALLOWED_INTERVALS as readonly number[]).includes(minutes)) return false
  store.intervalMinutes = minutes
  persist()
  return true
}

function nextFetchTs(): number | null {
  if (!apiKey()) return null
  if (!store.lastFetchAt) return Date.now()
  return store.lastFetchAt + vesselsIntervalMinutes() * MINUTE_MS
}

function nextHistoryTs(): number | null {
  if (!apiKey()) return null
  const stamps = Object.values(store.historyAt)
  if (!stamps.length) return Date.now()
  return Math.min(...stamps) + DAY_MS
}

export function vesselsApiStatus(): VesselsApiStatus {
  const next = nextFetchTs()
  const nextHistory = nextHistoryTs()
  return {
    configured: vesselsConfigured(),
    intervalMinutes: vesselsIntervalMinutes(),
    lastFetchAt: store.lastFetchAt ? new Date(store.lastFetchAt).toISOString() : null,
    nextFetchAt: next ? new Date(next).toISOString() : null,
    lastHistoryAt: store.lastHistoryAt ? new Date(store.lastHistoryAt).toISOString() : null,
    nextHistoryAt: nextHistory ? new Date(nextHistory).toISOString() : null,
    lastError: store.lastError ?? store.lastHistoryError,
    vesselCount: listFleet().length,
    pinConfigured: pinConfigured(),
  }
}

export async function refreshVesselsIfNeeded(force = false): Promise<void> {
  if (!apiKey()) return
  const ships = listFleet()
    .map((trip) => tripShip(trip))
    .filter((ship): ship is NonNullable<typeof ship> => Boolean(ship?.mmsi))
  if (!ships.length) return
  if (!force) {
    if (lastFailAt && Date.now() - lastFailAt < FAIL_BACKOFF_MS) return
    const next = nextFetchTs()
    if (next && Date.now() < next) return
  }
  if (inflight) {
    await inflight
    return
  }
  inflight = fetchFleet(ships).finally(() => {
    inflight = null
  })
  await inflight
}

export async function forceRefreshVessels(): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey()) return { ok: false, error: 'not_configured' }
  if (!listFleet().length) return { ok: false, error: 'no_ships' }
  lastFailAt = null
  await refreshVesselsIfNeeded(true)
  if (store.lastError && !store.lastFetchAt) return { ok: false, error: store.lastError }
  if (store.lastError) return { ok: false, error: store.lastError }
  return { ok: true }
}

async function fetchFleet(ships: { mmsi: string; imo: string; name: string }[]): Promise<void> {
  const vessels = ships.map((ship) => {
    const row: { imo?: string; mmsi?: string } = {}
    if (ship.imo) row.imo = ship.imo
    if (ship.mmsi) row.mmsi = ship.mmsi
    return row
  })
  try {
    const response = await fetch(`${BASE}/vessels/fleet`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ vessels, include_positions: true, include_routes: true }),
      signal: AbortSignal.timeout(20_000),
    })
    store.lastAttemptAt = Date.now()
    const text = await response.text()
    if (!response.ok) {
      store.lastError = parseError(text) || `HTTP ${response.status}`
      lastFailAt = Date.now()
      persist()
      console.warn('Vessels API error:', store.lastError)
      return
    }
    const json = JSON.parse(text) as {
      success?: boolean
      message?: string
      data?: { vessels?: unknown[] }
    }
    if (json.success === false) {
      store.lastError = json.message || 'vessels_error'
      lastFailAt = Date.now()
      persist()
      return
    }
    const rows = Array.isArray(json.data?.vessels) ? json.data.vessels : []
    let applied = 0
    for (const raw of rows) {
      const parsed = parseVessel(raw)
      if (!parsed) continue
      store.fixes[parsed.mmsi] = parsed.fix
      ingestFix(parsed.mmsi, parsed.fix, 'external')
      if (parsed.fix.destination || parsed.fix.eta || parsed.fix.name) {
        rememberVoyage(parsed.mmsi, {
          destination: parsed.fix.destination,
          eta: parsed.fix.eta,
          name: parsed.fix.name,
        })
      }
      applied += 1
    }
    store.lastFetchAt = Date.now()
    store.lastError = applied === 0 ? 'no_position' : null
    lastFailAt = applied === 0 ? Date.now() : null
    persist()
    console.log(`Vessels API fleet ${applied}/${ships.length} at ${new Date(store.lastFetchAt).toISOString()}`)
  } catch (error) {
    store.lastAttemptAt = Date.now()
    store.lastError = error instanceof Error ? error.message : 'network_error'
    lastFailAt = Date.now()
    persist()
    console.warn('Vessels API error:', store.lastError)
  }
}

function parseVessel(raw: unknown): { mmsi: string; fix: VesselsFix } | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const mmsi = digits(row.mmsi)
  if (!mmsi) return null
  const position = isRecord(row.position) ? row.position : row
  const lat = readCoord(position.latitude ?? position.lat)
  const lng = readCoord(position.longitude ?? position.lng ?? position.lon)
  if (lat == null || lng == null) return null
  const route = isRecord(row.route) ? row.route : null
  const dest =
    readText(route?.destination_port) ??
    readText(position.destination) ??
    null
  const etaRaw = route?.eta ?? position.eta
  const etaTs = parseUtc(etaRaw)
  return {
    mmsi,
    fix: {
      lat,
      lng,
      ts: parseUtc(position.timestamp_utc) ?? parseUtc(position.timestamp) ?? Date.now(),
      sog: readSog(position.speed_knots ?? position.speed),
      cog: readCourse(position.course_degrees ?? position.course),
      heading: readCourse(position.heading_degrees ?? position.heading),
      navStatus: navStatus(position.navigational_status),
      destination: dest,
      eta: etaTs ? new Date(etaTs).toISOString() : null,
      name: readText(row.name),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readCoord(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const n = Number(value.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function readSog(value: unknown): number | null {
  const n = readCoord(value)
  return n != null && n >= 0 && n < 80 ? n : null
}

function readCourse(value: unknown): number | null {
  const n = readCoord(value)
  return n != null && n >= 0 && n < 360 ? n : null
}

function parseUtc(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const stamp = Date.parse(value)
  return Number.isFinite(stamp) ? stamp : null
}

function navStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 15) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 15) return numeric
  const text = value.toLowerCase()
  if (text.includes('moor')) return 5
  if (text.includes('anchor')) return 1
  if (text.includes('aground')) return 6
  if (text.includes('not under command')) return 2
  if (text.includes('restricted') || text.includes('constrained')) return 3
  if (text.includes('sail')) return 8
  if (text.includes('under way') || text.includes('underway')) return 0
  return null
}

export async function refreshHistoryIfNeeded(): Promise<void> {
  if (!apiKey()) return
  const ships = listFleet()
    .map((trip) => tripShip(trip))
    .filter((ship): ship is NonNullable<typeof ship> => Boolean(ship?.mmsi))
  if (!ships.length) return
  const due = ships.filter((ship) => {
    const last = store.historyAt[ship.mmsi] ?? 0
    return Date.now() - last >= DAY_MS
  })
  if (!due.length) return
  if (historyInflight) {
    await historyInflight
    return
  }
  historyInflight = fetchHistory(due).finally(() => {
    historyInflight = null
  })
  await historyInflight
}

async function fetchHistory(ships: { mmsi: string; imo: string; name: string }[]): Promise<void> {
  let lastError: string | null = null
  let any = false
  for (const ship of ships) {
    const seeded = Boolean(store.historySeeded[ship.mmsi])
    const hours = seeded ? HISTORY_DAILY_HOURS : HISTORY_SEED_HOURS
    const params = new URLSearchParams({ hours: String(hours) })
    if (ship.mmsi) params.set('mmsi', ship.mmsi)
    else if (ship.imo) params.set('imo', ship.imo)
    try {
      const response = await fetch(`${BASE}/vessels/track?${params}`, {
        headers: { 'X-API-Key': apiKey(), Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      const text = await response.text()
      if (!response.ok) {
        lastError = parseError(text) || `HTTP ${response.status}`
        console.warn(`Vessels API track ${ship.mmsi}:`, lastError)
        continue
      }
      const json = JSON.parse(text) as { success?: boolean; message?: string; data?: unknown }
      if (json.success === false) {
        lastError = json.message || 'track_error'
        continue
      }
      const parsed = parseTrack(json.data)
      if (!parsed.history.length && !parsed.fix) {
        lastError = 'no_track'
        continue
      }
      if (parsed.history.length) ingestHistory(ship.mmsi, parsed.history)
      if (parsed.fix) {
        store.fixes[ship.mmsi] = { ...parsed.fix, destination: parsed.destination, eta: parsed.eta, name: parsed.name }
        ingestFix(ship.mmsi, parsed.fix, 'external')
        if (parsed.destination || parsed.eta || parsed.name) {
          rememberVoyage(ship.mmsi, {
            destination: parsed.destination,
            eta: parsed.eta,
            name: parsed.name,
          })
        }
      }
      store.historyAt[ship.mmsi] = Date.now()
      store.historySeeded[ship.mmsi] = true
      store.lastHistoryAt = Date.now()
      any = true
      console.log(`Vessels API track ${ship.name} ${parsed.history.length} pts (${hours}h)`)
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'network_error'
      console.warn(`Vessels API track ${ship.mmsi}:`, lastError)
    }
  }
  store.lastHistoryError = any ? null : lastError
  persist()
}

function parseTrack(
  data: unknown,
): { history: LiveFix[]; fix: LiveFix | null; destination: string | null; eta: string | null; name: string | null } {
  const empty = { history: [] as LiveFix[], fix: null, destination: null, eta: null, name: null }
  if (!isRecord(data)) return empty
  const vessel = isRecord(data.vessel) ? data.vessel : data
  const current = isRecord(data.current_position) ? data.current_position : null
  const route = isRecord(data.route) ? data.route : null
  const historyRaw = Array.isArray(data.position_history) ? data.position_history : []
  const history: LiveFix[] = []
  for (const row of historyRaw) {
    if (!isRecord(row)) continue
    const lat = readCoord(row.latitude ?? row.lat)
    const lng = readCoord(row.longitude ?? row.lng ?? row.lon)
    const ts = parseUtc(row.timestamp_utc ?? row.timestamp)
    if (lat == null || lng == null || ts == null) continue
    history.push({
      lat,
      lng,
      ts,
      sog: readSog(row.speed_knots ?? row.speed),
      cog: readCourse(row.course_degrees ?? row.course),
      heading: readCourse(row.heading_degrees ?? row.heading),
      navStatus: navStatus(row.navigational_status),
    })
  }
  history.sort((a, b) => a.ts - b.ts)
  let fix: LiveFix | null = null
  if (current) {
    const lat = readCoord(current.latitude ?? current.lat)
    const lng = readCoord(current.longitude ?? current.lng ?? current.lon)
    if (lat != null && lng != null) {
      fix = {
        lat,
        lng,
        ts: parseUtc(current.timestamp_utc ?? current.timestamp) ?? Date.now(),
        sog: readSog(current.speed_knots ?? current.speed),
        cog: readCourse(current.course_degrees ?? current.course),
        heading: readCourse(current.heading_degrees ?? current.heading),
        navStatus: navStatus(current.navigational_status),
      }
    }
  }
  const dest = readText(route?.destination_port) ?? readText(current?.destination)
  const etaTs = parseUtc(route?.eta ?? current?.eta)
  return {
    history,
    fix,
    destination: dest,
    eta: etaTs ? new Date(etaTs).toISOString() : null,
    name: readText(vessel.name),
  }
}

function parseError(text: string): string | null {
  try {
    const data = JSON.parse(text) as { message?: string; error?: string }
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim()
    if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
  } catch {
    /* raw */
  }
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length < 240 ? trimmed : null
}

export function startVesselsPoll(): void {
  if (pollTimer) return
  void refreshVesselsIfNeeded().then(() => refreshHistoryIfNeeded())
  pollTimer = setInterval(() => {
    void refreshVesselsIfNeeded().then(() => refreshHistoryIfNeeded())
  }, 60_000)
}
