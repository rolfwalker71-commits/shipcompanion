export type Locale = 'de' | 'en'

export type PositionSource = 'live' | 'approx'
export type TrackingStatus = 'live' | 'estimated' | 'last-known' | 'no-key' | 'no-signal' | 'ais-error'
export type AisNavState = 'moored' | 'anchored' | 'underway' | 'restricted' | 'aground' | 'unknown'
export type SeenSource = 'ais' | 'vessels' | 'datadocked' | 'manual'

export type GeoPoint = {
  lat: number
  lng: number
}

export type PortStop = {
  id: string
  name: string
  nameDe: string
  lat: number
  lng: number
  arriveAt: string
  departAt: string
}

export type CruiseShip = {
  id: string
  name: string
  lineId: string
  line: string
  lineDe: string
  mmsi: string
  imo: string
}

export type ItineraryPreset = {
  id: string
  title: string
  titleDe: string
  shipId: string
  stops: PortStop[]
}

export type Trip = {
  /** Stable id, usually the MMSI. Unique in the fleet. */
  id: string
  shipId: string
  /** Optional overrides when the catalog MMSI/IMO is wrong or missing. */
  mmsi?: string
  imo?: string
  customShip?: { name: string; mmsi: string; imo?: string; line: string; lineDe: string }
  startDate: string
  endDate: string
  presetId: string
  stops: PortStop[]
}

export type Fleet = {
  ships: Trip[]
}

export type WeatherInfo = {
  tempC: number
  weatherCode: number
  labelDe: string
  labelEn: string
  timezone?: string | null
  sunrise?: string | null
  sunset?: string | null
}

export type SnapshotRequest = {
  mmsi: string
  imo?: string
  shipName: string
  locale: Locale
  stops: PortStop[]
}

export type SnapshotResponse = {
  position: GeoPoint & { source: PositionSource }
  tracking: TrackingStatus
  seenAt: string | null
  seenSource: SeenSource | null
  seenAccuracyM: number | null
  motion: {
    nav: AisNavState
    sogKn: number | null
    cog: number | null
    heading: number | null
  } | null
  voyage: {
    destination: string | null
    eta: string | null
  } | null
  nextPort: {
    name: string
    arriveAt: string
    lat: number
    lng: number
    atPort: boolean
    berthName: string | null
    departAt: string | null
  }
  departure: {
    portName: string
    planned: string
    actual: string | null
  } | null
  fromPort: string | null
  /** Live GPS is far from every planned stop (e.g. other ocean than this itinerary). */
  offItinerary: boolean
  /** Clock says this port, but GPS is at a different itinerary harbor. */
  scheduledPort: string | null
  distanceKm: number | null
  weather: WeatherInfo | null
  sun: { sunrise: string; sunset: string } | null
  shipTz: string
  narrative: string
  path: GeoPoint[]
  track: GeoPoint[]
  gap: GeoPoint[]
  forecast: GeoPoint[]
  dataDocked: {
    remaining: number
    monthlyLimit: number
    seenAt: string | null
    source: 'TER' | 'SAT' | null
    lastError: string | null
  } | null
  vesselsApi: VesselsApiStatus | null
}

export type DataDockedStatus = {
  configured: boolean
  usedThisMonth: number
  monthlyLimit: number
  remaining: number
  credits: number | null
  lastFetchAt: string | null
  nextFetchAt: string | null
  lastError: string | null
  lastSource: 'TER' | 'SAT' | null
  intervalHours: number
  pinConfigured: boolean
}

export type VesselsApiStatus = {
  configured: boolean
  intervalMinutes: number
  lastFetchAt: string | null
  lastAttemptAt: string | null
  nextFetchAt: string | null
  lastHistoryAt: string | null
  nextHistoryAt: string | null
  lastError: string | null
  lastHistoryError: string | null
  rateLimitedUntil: string | null
  vesselCount: number
  pinConfigured: boolean
}

export type TimelineKind =
  | 'departed'
  | 'arrived'
  | 'approaching'
  | 'ais-gap'
  | 'ais-back'
  | 'docked-back'
  | 'manual-position'

export type TimelineEvent = {
  id: string
  kind: TimelineKind
  at: string
  titleDe: string
  titleEn: string
  detailDe?: string
  detailEn?: string
  mmsi?: string
  shipName?: string
}
