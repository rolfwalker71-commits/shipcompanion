export type Locale = 'de' | 'en'

export type PositionSource = 'live' | 'approx'
export type TrackingStatus = 'live' | 'estimated' | 'last-known' | 'no-key' | 'no-signal' | 'ais-error'
export type AisNavState = 'moored' | 'anchored' | 'underway' | 'restricted' | 'aground' | 'unknown'

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
  shipId: string
  customShip?: { name: string; mmsi: string; line: string; lineDe: string }
  startDate: string
  endDate: string
  presetId: string
  stops: PortStop[]
}

export type WeatherInfo = {
  tempC: number
  weatherCode: number
  labelDe: string
  labelEn: string
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
  zone: string | null
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
  distanceKm: number | null
  weather: WeatherInfo | null
  narrative: string
  path: GeoPoint[]
  track: GeoPoint[]
  forecast: GeoPoint[]
}

export type VesselFinderStatus = {
  configured: boolean
  usedThisMonth: number
  monthlyLimit: number
  remaining: number
  credits: number | null
  expiration: string | null
  lastFetchAt: string | null
  nextFetchAt: string | null
  lastError: string | null
  lastSource: 'TER' | 'SAT' | null
}

export type TimelineKind = 'departed' | 'arrived' | 'approaching' | 'ais-gap' | 'ais-back'

export type TimelineEvent = {
  id: string
  kind: TimelineKind
  at: string
  titleDe: string
  titleEn: string
  detailDe?: string
  detailEn?: string
}
