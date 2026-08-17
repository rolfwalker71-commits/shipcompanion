type VesselFix = {
  lat: number
  lng: number
  ts: number
  source: 'TER' | 'SAT'
  zone: string | null
  destination: string | null
}

const cache = new Map<string, { fix: VesselFix | null; fetchedAt: number; error: string | null }>()
const CACHE_MS = 3 * 60 * 1000

function apiKey(): string {
  return process.env.VESSELFINDER_API_KEY?.trim() ?? ''
}

export function vesselFinderConfigured(): boolean {
  return apiKey().length > 0
}

export function vesselFinderError(mmsi: string): string | null {
  return cache.get(mmsi)?.error ?? null
}

export async function fetchVesselFinder(mmsi: string, imo?: string): Promise<VesselFix | null> {
  const key = apiKey()
  if (!key || !mmsi) return null

  const cached = cache.get(mmsi)
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.fix

  const url = new URL('https://api.vesselfinder.com/vessels')
  url.searchParams.set('userkey', key)
  url.searchParams.set('mmsi', mmsi)
  if (imo) url.searchParams.set('imo', imo)
  url.searchParams.set('sat', process.env.VESSELFINDER_SATELLITE === '0' ? '0' : '1')

  const response = await fetch(url)
  const data = (await response.json()) as
    | { error?: string }
    | { AIS?: Record<string, unknown> }[]

  if (!response.ok || (!Array.isArray(data) && data && 'error' in data && data.error)) {
    const message = !Array.isArray(data) && data?.error ? String(data.error) : `HTTP ${response.status}`
    cache.set(mmsi, { fix: cached?.fix ?? null, fetchedAt: Date.now(), error: message })
    console.warn('VesselFinder error:', message)
    return cached?.fix ?? null
  }

  if (!Array.isArray(data) || data.length === 0) {
    cache.set(mmsi, { fix: null, fetchedAt: Date.now(), error: null })
    return null
  }

  const ais = data[0]?.AIS
  const lat = Number(ais?.LATITUDE)
  const lng = Number(ais?.LONGITUDE)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    cache.set(mmsi, { fix: null, fetchedAt: Date.now(), error: null })
    return null
  }

  const stamp = Date.parse(String(ais?.TIMESTAMP ?? '').replace(' ', 'T').replace(' UTC', 'Z'))
  const src = ais?.SRC === 'SAT' ? 'SAT' : 'TER'
  const fix: VesselFix = {
    lat,
    lng,
    ts: Number.isFinite(stamp) ? stamp : Date.now(),
    source: src,
    zone: typeof ais?.ZONE === 'string' && ais.ZONE ? ais.ZONE : null,
    destination: typeof ais?.DESTINATION === 'string' && ais.DESTINATION ? ais.DESTINATION : null,
  }
  cache.set(mmsi, { fix, fetchedAt: Date.now(), error: null })
  return fix
}
