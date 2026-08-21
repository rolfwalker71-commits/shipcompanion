import WebSocket from 'ws'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { GeoPoint, PortStop } from '../shared/types.ts'
import { haversineKm } from '../shared/geo.ts'
import { isStoppedNav, isUnderwayNav, navStateFromAis, parseAisEta } from '../shared/ais.ts'

export type LiveFix = GeoPoint & {
  ts: number
  sog?: number | null
  navStatus?: number | null
  cog?: number | null
  heading?: number | null
}

export type VoyageData = {
  destination: string | null
  eta: string | null
  name: string | null
}

type Track = {
  fix: LiveFix | null
  aisFix: LiveFix | null
  voyage: VoyageData | null
  trail: GeoPoint[]
  berthId: string | null
  parked: GeoPoint | null
  actualDepartures: Record<string, number>
}

type CachedTrack = {
  lat?: number
  lng?: number
  ts?: number
  sog?: number | null
  navStatus?: number | null
  cog?: number | null
  heading?: number | null
  berthId?: string | null
  parked?: GeoPoint | null
  actualDepartures?: Record<string, number>
  destination?: string | null
  eta?: string | null
  shipName?: string | null
  trail?: GeoPoint[]
  aisTs?: number
}

const WORLD_BOX: [[number, number], [number, number]] = [
  [-90, -180],
  [90, 180],
]
const CACHE_FILE = 'data/ais-cache.json'
const PORT_KM = 5
const LEFT_PIER_KM = 0.8
const MOVING_KNOTS = 2.5
const MIN_TRAIL_KM = 0.8
const MAX_TRAIL = 600
export const AIS_LIVE_MS = 20 * 60 * 1000
const AIS_SILENCE_MS = 12 * 60 * 1000
const MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
]

const tracks = new Map<string, Track>()
const tripStops = new Map<string, PortStop[]>()
let socket: WebSocket | null = null
const watched = new Set<string>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let connecting = false
let lastError: string | null = null
let lastAisMessageAt = 0
let socketOpenedAt = 0
let cacheReady: Promise<void> | null = null
/** After connect, wait this long for coastal AIS before spending a Data Docked credit. */
export const AIS_FALLBACK_GRACE_MS = 3 * 60 * 1000

function apiKey(): string {
  return process.env.AISSTREAM_API_KEY?.trim() ?? ''
}

function readCoord(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readHeading(value: unknown): number | null {
  const heading = readCoord(value)
  if (heading == null || heading < 0 || heading >= 360 || heading === 511) return null
  return heading
}

function readCog(value: unknown): number | null {
  const cog = readCoord(value)
  if (cog == null || cog < 0 || cog >= 360) return null
  return cog
}

/** AIS SOG is knots; 102.3 / 1023 means not available. Some feeds send tenths (185 = 18.5 kn). */
function readSog(value: unknown): number | null {
  const raw = readCoord(value)
  if (raw == null || raw < 0 || raw >= 102.2) return null
  const kn = raw > 80 ? raw / 10 : raw
  return kn < 80 ? kn : null
}

function inferredSog(prev: LiveFix | null, next: LiveFix): number | null {
  if (!prev || next.ts <= prev.ts) return null
  const hours = (next.ts - prev.ts) / 3_600_000
  if (hours < 1 / 60 || hours > 0.75) return null
  const kn = haversineKm(prev, next) / hours / 1.852
  if (kn < 0 || kn >= 80) return null
  return Math.round(kn * 10) / 10
}

function parseAisTime(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return Date.now()
  const normalized = value.replace(' +0000 UTC', 'Z').replace(' UTC', 'Z').replace(' ', 'T')
  const ts = Date.parse(normalized)
  return Number.isFinite(ts) ? ts : Date.now()
}

function emptyTrack(): Track {
  return { fix: null, aisFix: null, voyage: null, trail: [], berthId: null, parked: null, actualDepartures: {} }
}

function ensureTrack(mmsi: string): Track {
  const current = tracks.get(mmsi)
  if (current) return current
  const created = emptyTrack()
  tracks.set(mmsi, created)
  return created
}

async function loadCache(): Promise<void> {
  if (!existsSync(CACHE_FILE)) return
  try {
    const raw = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as Record<string, CachedTrack>
    for (const [mmsi, row] of Object.entries(raw)) {
      const hasFix = typeof row?.lat === 'number' && typeof row?.lng === 'number' && typeof row?.ts === 'number'
      const fix = hasFix
        ? {
            lat: row.lat as number,
            lng: row.lng as number,
            ts: row.ts as number,
            sog: readSog(row.sog),
            navStatus: row.navStatus ?? null,
            cog: row.cog ?? null,
            heading: row.heading ?? null,
          }
        : null
      const trail = Array.isArray(row.trail)
        ? row.trail.filter(
            (point): point is GeoPoint =>
              typeof point?.lat === 'number' && typeof point?.lng === 'number',
          )
        : []
      tracks.set(mmsi, {
        fix,
        aisFix: fix && typeof row.aisTs === 'number' ? { ...fix, ts: row.aisTs } : fix,
        voyage:
          row.destination || row.eta || row.shipName
            ? {
                destination: row.destination ?? null,
                eta: row.eta ?? null,
                name: row.shipName ?? null,
              }
            : null,
        trail: trail.length ? trail : fix ? [{ lat: fix.lat, lng: fix.lng }] : [],
        berthId: row.berthId ?? null,
        parked: row.parked ?? (hasFix ? { lat: row.lat as number, lng: row.lng as number } : null),
        actualDepartures: row.actualDepartures ?? {},
      })
    }
  } catch {
    // ignore corrupt cache
  }
}

async function saveCache(): Promise<void> {
  await mkdir('data', { recursive: true })
  const payload: Record<string, CachedTrack> = {}
  for (const [mmsi, track] of tracks) {
    payload[mmsi] = {
      ...(track.fix ?? {}),
      berthId: track.berthId,
      parked: track.parked,
      actualDepartures: track.actualDepartures,
      destination: track.voyage?.destination ?? null,
      eta: track.voyage?.eta ?? null,
      shipName: track.voyage?.name ?? null,
      trail: track.trail,
      aisTs: track.aisFix?.ts,
    }
  }
  await writeFile(CACHE_FILE, JSON.stringify(payload), 'utf8')
}

/** Record a position in the trail. AIS frames mark aisFix; Vessels API does not. */
export function ingestFix(mmsi: string, fix: LiveFix, source: 'ais' | 'external' = 'external'): void {
  rememberPosition(mmsi, fix, source === 'ais')
}

function rememberPosition(mmsi: string, fix: LiveFix, markAis = true): void {
  const prev = ensureTrack(mmsi)
  if (!markAis && prev.fix && fix.ts < prev.fix.ts - 5_000) {
    return
  }
  const statusNav = navStateFromAis(fix.navStatus, null)
  let sog = fix.sog ?? inferredSog(prev.fix, fix)
  if (sog == null) sog = isStoppedNav(statusNav) ? 0 : (prev.fix?.sog ?? null)
  const merged: LiveFix = { ...fix, sog }
  const stops = tripStops.get(mmsi) ?? []
  const nearby = nearestStop(merged, stops)
  const nav = navStateFromAis(merged.navStatus, merged.sog)
  const parked = isStoppedNav(nav) || (nav === 'unknown' && Boolean(nearby) && (merged.sog == null || merged.sog < 1.2))
  const sailing =
    isUnderwayNav(nav) || (merged.sog != null && merged.sog >= MOVING_KNOTS) || merged.navStatus === 0 || merged.navStatus === 8
  const departures = { ...prev.actualDepartures }
  let berthId = prev.berthId
  let parkedPoint = prev.parked

  if (parked && nearby) {
    berthId = nearby.id
    parkedPoint = { lat: merged.lat, lng: merged.lng }
  } else if (berthId && !departures[berthId]) {
    const from = parkedPoint ?? nearby ?? prev.fix
    const moved = from ? haversineKm(from, merged) : 0
    const leftHarbor = nearby == null && !parked
    if ((sailing && (moved >= LEFT_PIER_KM || nav === 'underway')) || leftHarbor) {
      departures[berthId] = merged.ts
      berthId = nearby?.id ?? null
      parkedPoint = null
    }
  } else if (!nearby) {
    berthId = null
  }

  tracks.set(mmsi, {
    ...prev,
    fix: merged,
    aisFix: markAis ? merged : prev.aisFix,
    trail: appendTrail(prev.trail, merged, parked),
    berthId,
    parked: parkedPoint,
    actualDepartures: departures,
  })
  void saveCache()
}

export function rememberVoyage(mmsi: string, voyage: VoyageData): void {
  const prev = ensureTrack(mmsi)
  tracks.set(mmsi, {
    ...prev,
    voyage: {
      destination: voyage.destination ?? prev.voyage?.destination ?? null,
      eta: voyage.eta ?? prev.voyage?.eta ?? null,
      name: voyage.name ?? prev.voyage?.name ?? null,
    },
  })
  void saveCache()
}

function nearestStop(point: GeoPoint, stops: PortStop[]): PortStop | null {
  let best: PortStop | null = null
  let bestKm = PORT_KM
  for (const stop of stops) {
    const km = haversineKm(point, stop)
    if (km <= bestKm) {
      best = stop
      bestKm = km
    }
  }
  return best
}

function appendTrail(trail: GeoPoint[], fix: LiveFix, parked: boolean): GeoPoint[] {
  const point = { lat: fix.lat, lng: fix.lng, ts: fix.ts }
  if (trail.length === 0) return [point]
  const last = trail[trail.length - 1]
  const moved = haversineKm(last, point)
  if (parked || moved < MIN_TRAIL_KM) {
    return [...trail.slice(0, -1), point]
  }
  const next = [...trail, point]
  return next.length > MAX_TRAIL ? next.slice(next.length - MAX_TRAIL) : next
}

/** Merge timestamped history into the stored trail (used by Vessels /track). */
export function ingestHistory(mmsi: string, points: LiveFix[]): number {
  if (!mmsi || points.length === 0) return 0
  const prev = ensureTrack(mmsi)
  type Stamped = GeoPoint & { ts: number }
  const pool: Stamped[] = []
  for (const point of prev.trail) {
    const ts = typeof (point as GeoPoint & { ts?: number }).ts === 'number' ? (point as GeoPoint & { ts: number }).ts : 0
    if (ts > 0) pool.push({ lat: point.lat, lng: point.lng, ts })
  }
  let added = 0
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.ts)) continue
    pool.push({ lat: point.lat, lng: point.lng, ts: point.ts })
    added += 1
  }
  if (!added && pool.length === 0) return 0
  pool.sort((a, b) => a.ts - b.ts)
  const merged: Stamped[] = []
  for (const point of pool) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push(point)
      continue
    }
    if (point.ts - last.ts < 45_000 || haversineKm(last, point) < MIN_TRAIL_KM) {
      merged[merged.length - 1] = point
      continue
    }
    merged.push(point)
  }
  const trail = merged.length > MAX_TRAIL ? merged.slice(merged.length - MAX_TRAIL) : merged
  tracks.set(mmsi, { ...prev, trail })
  void saveCache()
  return added
}

function subscribe(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  const key = apiKey()
  if (!key || watched.size === 0) return
  socket.send(
    JSON.stringify({
      APIKey: key,
      BoundingBoxes: [WORLD_BOX],
      FiltersShipMMSI: [...watched],
      FilterMessageTypes: MESSAGE_TYPES,
    }),
  )
}

function startHeartbeat(): void {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(() => {
    if (watched.size === 0 || !apiKey()) {
      stopHeartbeat()
      return
    }
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      connect()
      return
    }
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.ping()
      } catch {
        socket.close()
        return
      }
    }
    if (lastAisMessageAt > 0 && Date.now() - lastAisMessageAt > AIS_SILENCE_MS) {
      console.warn('AISStream silent for 12 minutes, reconnecting')
      lastAisMessageAt = Date.now()
      socket.close()
    }
  }, 30_000)
}

function stopHeartbeat(): void {
  if (!heartbeatTimer) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function connect(): void {
  const key = apiKey()
  if (!key || watched.size === 0) return
  if (connecting) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  connecting = true
  lastError = null
  const next = new WebSocket('wss://stream.aisstream.io/v0/stream')
  socket = next

  next.on('open', () => {
    if (socket !== next) return
    connecting = false
    lastError = null
    lastAisMessageAt = Date.now()
    socketOpenedAt = Date.now()
    console.log(`AISStream connected, watching ${[...watched].join(',') || 'none'}`)
    subscribe()
    startHeartbeat()
  })

  next.on('message', (raw) => {
    if (socket !== next) return
    try {
      const payload = JSON.parse(String(raw)) as {
        error?: string
        MessageType?: string
        MetaData?: {
          MMSI?: string | number
          latitude?: number
          longitude?: number
          time_utc?: string
          ShipName?: string
        }
        Message?: {
          PositionReport?: Record<string, unknown>
          StandardClassBPositionReport?: Record<string, unknown>
          ExtendedClassBPositionReport?: Record<string, unknown>
          ShipStaticData?: Record<string, unknown>
        }
      }
      if (payload.error) {
        lastError = payload.error
        console.warn('AISStream error:', payload.error)
        return
      }

      lastError = null
      lastAisMessageAt = Date.now()

      const staticData = payload.Message?.ShipStaticData
      const report =
        payload.Message?.PositionReport ??
        payload.Message?.StandardClassBPositionReport ??
        payload.Message?.ExtendedClassBPositionReport
      const mmsi = String(payload.MetaData?.MMSI ?? staticData?.UserID ?? report?.UserID ?? '')
      if (!mmsi) return

      if (staticData) {
        const eta = staticData.Eta as { Month?: number; Day?: number; Hour?: number; Minute?: number } | undefined
        rememberVoyage(mmsi, {
          destination: typeof staticData.Destination === 'string' ? staticData.Destination : null,
          eta: parseAisEta(
            eta
              ? {
                  month: Number(eta.Month ?? 0),
                  day: Number(eta.Day ?? 0),
                  hour: Number(eta.Hour ?? 0),
                  minute: Number(eta.Minute ?? 0),
                }
              : null,
          ),
          name: typeof staticData.Name === 'string' ? staticData.Name.trim() : (payload.MetaData?.ShipName ?? null),
        })
      }

      if (!report) return
      const lat = readCoord(payload.MetaData?.latitude) ?? readCoord(report.Latitude)
      const lng = readCoord(payload.MetaData?.longitude) ?? readCoord(report.Longitude)
      if (lat == null || lng == null) return
      rememberPosition(mmsi, {
        lat,
        lng,
        ts: parseAisTime(payload.MetaData?.time_utc),
        sog: readSog(report.Sog ?? report.SOG ?? report.SpeedOverGround ?? report.sog),
        navStatus: readCoord(report.NavigationalStatus),
        cog: readCog(report.Cog ?? report.COG),
        heading: readHeading(report.TrueHeading),
      }, true)
      if (watched.has(mmsi)) {
        console.log(`AIS ${mmsi} ${lat.toFixed(3)},${lng.toFixed(3)}`)
      }
    } catch {
      // ignore malformed AIS frames
    }
  })

  next.on('close', () => {
    if (socket === next) {
      socket = null
      connecting = false
      stopHeartbeat()
      if (watched.size === 0 || !apiKey()) return
      reconnectTimer ??= setTimeout(() => {
        reconnectTimer = null
        connect()
      }, 5000)
    }
  })

  next.on('error', () => {
    if (socket === next) next.close()
  })
}

export function watchMmsi(mmsi: string, stops: PortStop[] = []): void {
  if (!mmsi) return
  cacheReady ??= loadCache()
  watched.add(mmsi)
  if (stops.length) tripStops.set(mmsi, stops)
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connect()
    return
  }
  subscribe()
}

export function livePosition(mmsi: string, maxAgeMs = AIS_LIVE_MS): LiveFix | null {
  const track = tracks.get(mmsi)
  const fix = track?.aisFix ?? track?.fix
  if (!fix) return null
  if (Date.now() - fix.ts > maxAgeMs) return null
  return fix
}

export function lastKnownPosition(mmsi: string): LiveFix | null {
  const track = tracks.get(mmsi)
  const ais = track?.aisFix ?? null
  const last = track?.fix ?? null
  if (ais && last) return ais.ts >= last.ts ? ais : last
  return ais ?? last
}

export function lastAisPosition(mmsi: string): LiveFix | null {
  return tracks.get(mmsi)?.aisFix ?? null
}

export function voyageOf(mmsi: string): VoyageData | null {
  return tracks.get(mmsi)?.voyage ?? null
}

export function aisTrail(mmsi: string): GeoPoint[] {
  return tracks.get(mmsi)?.trail ?? []
}

export function actualDeparture(mmsi: string, stopId: string): number | null {
  return tracks.get(mmsi)?.actualDepartures[stopId] ?? null
}

export async function waitForLive(mmsi: string, timeoutMs = 5000): Promise<LiveFix | null> {
  await (cacheReady ??= loadCache())
  if (!socket || socket.readyState === WebSocket.CLOSED) connect()
  const existing = livePosition(mmsi)
  if (existing) return existing
  // Last known from disk is enough for the first paint; do not stall the UI for a live frame.
  const known = lastKnownPosition(mmsi)
  if (known) return known
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const fix = livePosition(mmsi)
    if (fix) return fix
  }
  return livePosition(mmsi) ?? lastKnownPosition(mmsi)
}

export function aisConfigured(): boolean {
  return apiKey().length > 0
}

export function aisConnected(): boolean {
  return Boolean(socket && socket.readyState === WebSocket.OPEN)
}

/** True while the AIS websocket is still opening or just opened. */
export function aisFallbackGraceActive(): boolean {
  if (!apiKey()) return false
  if (connecting || socket?.readyState === WebSocket.CONNECTING) return true
  if (!socketOpenedAt) return false
  return Date.now() - socketOpenedAt < AIS_FALLBACK_GRACE_MS
}

export function aisError(): string | null {
  return lastError
}
