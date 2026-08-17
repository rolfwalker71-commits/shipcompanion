import WebSocket from 'ws'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { GeoPoint, PortStop } from '../shared/types.ts'
import { haversineKm } from '../shared/geo.ts'

export type LiveFix = GeoPoint & {
  ts: number
  sog?: number | null
  navStatus?: number | null
}

type Track = {
  fix: LiveFix
  berthId: string | null
  parked: GeoPoint | null
  actualDepartures: Record<string, number>
}

type CachedTrack = LiveFix & {
  berthId?: string | null
  parked?: GeoPoint | null
  actualDepartures?: Record<string, number>
}

const WORLD_BOX: [[number, number], [number, number]] = [
  [-90, -180],
  [90, 180],
]
const CACHE_FILE = 'data/ais-cache.json'
const PORT_KM = 5
const LEFT_PIER_KM = 0.8
const MOVING_KNOTS = 2.5

const tracks = new Map<string, Track>()
const tripStops = new Map<string, PortStop[]>()
let socket: WebSocket | null = null
const watched = new Set<string>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let lastError: string | null = null
let cacheReady: Promise<void> | null = null

function apiKey(): string {
  return process.env.AISSTREAM_API_KEY?.trim() ?? ''
}

function readCoord(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isParked(sog: number | null | undefined, navStatus: number | null | undefined): boolean {
  if (navStatus === 1 || navStatus === 5) return true
  if (navStatus === 0 || navStatus === 8) return false
  if (sog != null) return sog < 1.2
  return false
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

async function loadCache(): Promise<void> {
  if (!existsSync(CACHE_FILE)) return
  try {
    const raw = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as Record<string, CachedTrack>
    for (const [mmsi, row] of Object.entries(raw)) {
      if (typeof row?.lat !== 'number' || typeof row?.lng !== 'number' || typeof row?.ts !== 'number') continue
      tracks.set(mmsi, {
        fix: {
          lat: row.lat,
          lng: row.lng,
          ts: row.ts,
          sog: row.sog ?? null,
          navStatus: row.navStatus ?? null,
        },
        berthId: row.berthId ?? null,
        parked: row.parked ?? { lat: row.lat, lng: row.lng },
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
      ...track.fix,
      berthId: track.berthId,
      parked: track.parked,
      actualDepartures: track.actualDepartures,
    }
  }
  await writeFile(CACHE_FILE, JSON.stringify(payload), 'utf8')
}

function remember(mmsi: string, fix: LiveFix): void {
  const prev = tracks.get(mmsi)
  const stops = tripStops.get(mmsi) ?? []
  const nearby = nearestStop(fix, stops)
  const parked = isParked(fix.sog, fix.navStatus) || (fix.sog == null && Boolean(nearby))
  const departures = { ...(prev?.actualDepartures ?? {}) }
  let berthId = prev?.berthId ?? null
  let parkedPoint = prev?.parked ?? null

  if (parked && nearby) {
    berthId = nearby.id
    parkedPoint = { lat: fix.lat, lng: fix.lng }
  } else if (berthId && !departures[berthId]) {
    const from = parkedPoint ?? nearby ?? prev?.fix
    const moved = from ? haversineKm(from, fix) : 0
    const sailing = (fix.sog != null && fix.sog >= MOVING_KNOTS) || fix.navStatus === 0 || fix.navStatus === 8
    const leftHarbor = nearby == null && !parked
    if ((sailing && moved >= LEFT_PIER_KM) || leftHarbor) {
      departures[berthId] = fix.ts
      berthId = nearby?.id ?? null
      parkedPoint = null
    }
  } else if (!nearby) {
    berthId = null
  }

  tracks.set(mmsi, { fix, berthId, parked: parkedPoint, actualDepartures: departures })
  void saveCache()
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
      FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'],
    }),
  )
}

function connect(): void {
  const key = apiKey()
  if (!key || watched.size === 0) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }

  lastError = null
  socket = new WebSocket('wss://stream.aisstream.io/v0/stream')

  socket.on('open', () => {
    subscribe()
  })

  socket.on('message', (raw) => {
    try {
      const payload = JSON.parse(String(raw)) as {
        error?: string
        MetaData?: { MMSI?: string | number; latitude?: number; longitude?: number }
        Message?: {
          PositionReport?: Record<string, unknown>
          StandardClassBPositionReport?: Record<string, unknown>
          ExtendedClassBPositionReport?: Record<string, unknown>
        }
      }
      if (payload.error) {
        lastError = payload.error
        console.warn('AISStream error:', payload.error)
        return
      }
      const report =
        payload.Message?.PositionReport ??
        payload.Message?.StandardClassBPositionReport ??
        payload.Message?.ExtendedClassBPositionReport
      const mmsi = String(payload.MetaData?.MMSI ?? report?.UserID ?? '')
      const lat = readCoord(payload.MetaData?.latitude) ?? readCoord(report?.Latitude)
      const lng = readCoord(payload.MetaData?.longitude) ?? readCoord(report?.Longitude)
      if (!mmsi || lat == null || lng == null) return
      remember(mmsi, {
        lat,
        lng,
        ts: Date.now(),
        sog: readCoord(report?.Sog ?? report?.SOG),
        navStatus: readCoord(report?.NavigationalStatus),
      })
    } catch {
      // ignore malformed AIS frames
    }
  })

  socket.on('close', () => {
    socket = null
    if (watched.size === 0 || !apiKey()) return
    reconnectTimer ??= setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 5000)
  })

  socket.on('error', () => {
    socket?.close()
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

export function livePosition(mmsi: string, maxAgeMs = 20 * 60 * 1000): LiveFix | null {
  const fix = tracks.get(mmsi)?.fix
  if (!fix) return null
  if (Date.now() - fix.ts > maxAgeMs) return null
  return fix
}

export function lastKnownPosition(mmsi: string): LiveFix | null {
  return tracks.get(mmsi)?.fix ?? null
}

export function actualDeparture(mmsi: string, stopId: string): number | null {
  return tracks.get(mmsi)?.actualDepartures[stopId] ?? null
}

export async function waitForLive(mmsi: string, timeoutMs = 5000): Promise<LiveFix | null> {
  await (cacheReady ??= loadCache())
  const existing = livePosition(mmsi)
  if (existing) return existing
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const fix = livePosition(mmsi)
    if (fix) return fix
    if (lastError) return lastKnownPosition(mmsi)
  }
  return livePosition(mmsi) ?? lastKnownPosition(mmsi)
}

export function aisConfigured(): boolean {
  return apiKey().length > 0
}

export function aisError(): string | null {
  return lastError
}
