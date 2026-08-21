import type { VesselsApiStatus } from '../shared/types.ts'
import { tripShip } from '../shared/ships.ts'
import { listFleet } from './fleet-store.ts'
import { ingestFix, ingestHistory, rememberVoyage, aisCacheReady, vesselsHistoryCount, type LiveFix } from './ais.ts'
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
  historyTriedAt: Record<string, number>
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
    historyTriedAt: {},
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
    historyTriedAt: raw.historyTriedAt && typeof raw.historyTriedAt === 'object' ? raw.historyTriedAt : {},
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
  const stamps = [...Object.values(store.historyAt), ...Object.values(store.historyTriedAt)]
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
    lastError: store.lastError,
    lastHistoryError: store.lastHistoryError,
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
      const mmsi = matchFleetMmsi(parsed, ships)
      store.fixes[mmsi] = parsed.fix
      ingestFix(mmsi, parsed.fix, 'external')
      if (parsed.fix.destination || parsed.fix.eta || parsed.fix.name) {
        rememberVoyage(mmsi, {
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

function matchFleetMmsi(
  parsed: { mmsi: string; imo: string },
  ships: { mmsi: string; imo: string }[],
): string {
  if (ships.some((ship) => ship.mmsi === parsed.mmsi)) return parsed.mmsi
  const byImo = ships.find((ship) => ship.imo && ship.imo === parsed.imo)
  return byImo?.mmsi || parsed.mmsi
}

function parseVessel(raw: unknown): { mmsi: string; imo: string; fix: VesselsFix } | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const mmsi = digits(row.mmsi)
  if (!mmsi) return null
  const imo = digits(row.imo)
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
    imo,
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
    if (vesselsHistoryCount(ship.mmsi) === 0) {
      const lastTry = store.historyTriedAt[ship.mmsi] ?? 0
      return lastTry === 0 || Date.now() - lastTry >= DAY_MS
    }
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
  for (const ship of ships) {
    const seeded = Boolean(store.historySeeded[ship.mmsi])
    const hours = seeded ? HISTORY_DAILY_HOURS : HISTORY_SEED_HOURS
    store.historyTriedAt[ship.mmsi] = Date.now()
    try {
      const result = await fetchTrackForShip(ship, hours)
      if (!result.ok) {
        lastError = `${ship.name}: ${result.error}`
        console.warn(`Vessels API track ${ship.mmsi}:`, result.error)
        continue
      }
      const parsed = parseTrack(result.data)
      if (!parsed.history.length && !parsed.fix) {
        lastError = `${ship.name}: no_track`
        continue
      }
      if (isRecord(result.data)) {
        const rawHist = Array.isArray(result.data.position_history) ? result.data.position_history.length : 0
        console.log(
          `Vessels API track ${ship.name} ${parsed.history.length} pts (${hours}h) raw_history=${rawHist} keys=${Object.keys(result.data).join(',')}`,
        )
      } else {
        console.log(`Vessels API track ${ship.name} ${parsed.history.length} pts (${hours}h)`)
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
    } catch (error) {
      lastError = `${ship.name}: ${error instanceof Error ? error.message : 'network_error'}`
      console.warn(`Vessels API track ${ship.mmsi}:`, lastError)
    }
  }
  store.lastHistoryError = lastError
  persist()
}

type TrackResult = { ok: true; data: unknown } | { ok: false; error: string }

async function fetchTrackForShip(
  ship: { mmsi: string; imo: string },
  hours: number,
): Promise<TrackResult> {
  const first = await fetchTrack(ship.mmsi ? { mmsi: ship.mmsi } : { imo: ship.imo }, hours)
  if (first.ok) return first
  if (ship.mmsi && ship.imo && isMissingIdentifier(first.error)) {
    const retry = await fetchTrack({ imo: ship.imo }, hours)
    if (retry.ok) return retry
    return { ok: false, error: retry.error }
  }
  return first
}

async function fetchTrack(
  id: { mmsi?: string; imo?: string },
  hours: number,
): Promise<TrackResult> {
  const params = new URLSearchParams({ hours: String(hours) })
  if (id.mmsi) params.set('mmsi', id.mmsi)
  else if (id.imo) params.set('imo', id.imo)
  const response = await fetch(`${BASE}/vessels/track?${params}`, {
    headers: { 'X-API-Key': apiKey(), Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok) {
    return { ok: false, error: parseError(text) || `HTTP ${response.status}` }
  }
  const json = JSON.parse(text) as { success?: boolean; message?: string; data?: unknown }
  if (json.success === false) {
    return { ok: false, error: json.message || 'track_error' }
  }
  return { ok: true, data: json.data }
}

function isMissingIdentifier(error: string): boolean {
  const text = error.toLowerCase()
  return text.includes('not found') || text.includes('identifier') || text.includes('no vessel')
}

function parseTrack(
  data: unknown,
): { history: LiveFix[]; fix: LiveFix | null; destination: string | null; eta: string | null; name: string | null } {
  const empty = { history: [] as LiveFix[], fix: null, destination: null, eta: null, name: null }
  if (!isRecord(data)) return empty
  const vessel = isRecord(data.vessel) ? data.vessel : data
  const current = isRecord(data.current_position)
    ? data.current_position
    : isRecord(data.currentPosition)
      ? data.currentPosition
      : null
  const route = isRecord(data.route) ? data.route : null
  const history: LiveFix[] = []
  const seen = new Set<string>()
  function addFix(fix: LiveFix | null) {
    if (!fix) return
    const key = `${fix.ts}:${fix.lat.toFixed(5)}:${fix.lng.toFixed(5)}`
    if (seen.has(key)) return
    seen.add(key)
    history.push(fix)
  }
  for (const rows of historyBags(data)) {
    for (const row of rows) addFix(readHistoryFix(row))
  }
  const fix = readHistoryFix(current)
  addFix(fix)
  history.sort((a, b) => a.ts - b.ts)
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

function historyBags(data: Record<string, unknown>): unknown[][] {
  const bags: unknown[][] = []
  const push = (value: unknown) => {
    if (Array.isArray(value) && value.length) bags.push(value)
  }
  push(data.position_history)
  push(data.positionHistory)
  push(data.history)
  push(data.positions)
  push(data.track)
  push(data.track_points)
  if (isRecord(data.route)) {
    push(data.route.position_history)
    push(data.route.positions)
    push(data.route.track)
    push(data.route.path)
  }
  return bags
}

function readHistoryFix(row: unknown): LiveFix | null {
  if (!isRecord(row)) return null
  const pos = isRecord(row.position) ? row.position : row
  const lat = readCoord(pos.latitude ?? pos.lat ?? row.latitude ?? row.lat)
  const lng = readCoord(pos.longitude ?? pos.lng ?? pos.lon ?? row.longitude ?? row.lng ?? row.lon)
  const ts = parseUtc(
    row.timestamp_utc ??
      row.timestampUtc ??
      row.timestamp ??
      row.time_utc ??
      row.timeUtc ??
      row.time ??
      pos.timestamp_utc ??
      pos.timestamp ??
      row.ts,
  )
  if (lat == null || lng == null || ts == null) return null
  return {
    lat,
    lng,
    ts,
    sog: readSog(row.speed_knots ?? row.speed ?? pos.speed_knots ?? pos.speed),
    cog: readCourse(row.course_degrees ?? row.course ?? pos.course_degrees ?? pos.course),
    heading: readCourse(row.heading_degrees ?? row.heading ?? pos.heading_degrees ?? pos.heading),
    navStatus: navStatus(row.navigational_status ?? pos.navigational_status),
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
  void aisCacheReady()
    .then(() => refreshVesselsIfNeeded())
    .then(() => refreshHistoryIfNeeded())
  pollTimer = setInterval(() => {
    void refreshVesselsIfNeeded().then(() => refreshHistoryIfNeeded())
  }, 60_000)
}
