import type { GeoPoint, PortStop } from './types.ts'
import { haversineKm } from './geo.ts'

/** Cruise berth / passenger terminal — not the city centroid. */
export type Harbor = {
  id: string
  name: string
  nameDe: string
  lat: number
  lng: number
  /** IANA zone for published arrive/depart times. */
  tz: string
  aliases: string[]
}

const harbors: Record<string, Harbor> = {
  barcelona: {
    id: 'barcelona',
    name: 'Barcelona',
    nameDe: 'Barcelona',
    lat: 41.355,
    lng: 2.178, // Moll Adossat, Terminal C/D
    tz: 'Europe/Madrid',
    aliases: ['barcelona', 'esbcn', 'bcn'],
  },
  palma: {
    id: 'palma',
    name: 'Palma de Mallorca',
    nameDe: 'Palma de Mallorca',
    lat: 39.5572,
    lng: 2.6305, // Moll de Ponent / Estació Marítima
    tz: 'Europe/Madrid',
    aliases: ['palma', 'mallorca', 'espmi', 'pmi'],
  },
  'la-spezia': {
    id: 'la-spezia',
    name: 'La Spezia',
    nameDe: 'La Spezia',
    lat: 44.106,
    lng: 9.8325, // Molo Garibaldi, west quay
    tz: 'Europe/Rome',
    aliases: ['la spezia', 'spezia', 'lt spezia', 'lt spe', 'laspezia', 'itspe', 'it spe'],
  },
  civitavecchia: {
    id: 'civitavecchia',
    name: 'Civitavecchia',
    nameDe: 'Civitavecchia (Rom)',
    lat: 42.0925,
    lng: 11.786, // Roma Cruise Terminal, quays 12–13
    tz: 'Europe/Rome',
    aliases: ['civitavecchia', 'itcvv', 'rome', 'roma', 'cvv'],
  },
  naples: {
    id: 'naples',
    name: 'Naples',
    nameDe: 'Neapel',
    lat: 40.8378,
    lng: 14.2565, // Stazione Marittima / Molo Angioino
    tz: 'Europe/Rome',
    aliases: ['naples', 'napoli', 'neapel', 'itnap', 'nap'],
  },
  'las-palmas': {
    id: 'las-palmas',
    name: 'Las Palmas',
    nameDe: 'Las Palmas',
    lat: 28.1422,
    lng: -15.4245, // Muelle Santa Catalina
    tz: 'Atlantic/Canary',
    aliases: ['las palmas', 'gran canaria', 'eslpa', 'lpa'],
  },
  tenerife: {
    id: 'tenerife',
    name: 'Santa Cruz de Tenerife',
    nameDe: 'Santa Cruz de Tenerife',
    lat: 28.4765,
    lng: -16.2415, // Muelle Norte cruise piers
    tz: 'Atlantic/Canary',
    aliases: ['tenerife', 'santa cruz', 'essct', 'tci'],
  },
  funchal: {
    id: 'funchal',
    name: 'Funchal',
    nameDe: 'Funchal',
    lat: 32.6419,
    lng: -16.9101, // Gare Marítima da Pontinha
    tz: 'Atlantic/Madeira',
    aliases: ['funchal', 'madeira', 'ptfnc'],
  },
  miami: {
    id: 'miami',
    name: 'Miami',
    nameDe: 'Miami',
    lat: 25.7785,
    lng: -80.177, // PortMiami, Dodge Island
    tz: 'America/New_York',
    aliases: ['miami', 'usmia', 'portmiami'],
  },
  nassau: {
    id: 'nassau',
    name: 'Nassau',
    nameDe: 'Nassau',
    lat: 25.0798,
    lng: -77.3424, // Prince George Wharf
    tz: 'America/Nassau',
    aliases: ['nassau', 'bsnas'],
  },
  cozumel: {
    id: 'cozumel',
    name: 'Cozumel',
    nameDe: 'Cozumel',
    lat: 20.4759,
    lng: -86.9748, // Puerta Maya
    tz: 'America/Cancun',
    aliases: ['cozumel', 'mxczm', 'san miguel'],
  },
  southampton: {
    id: 'southampton',
    name: 'Southampton',
    nameDe: 'Southampton',
    lat: 50.8964,
    lng: -1.4044,
    tz: 'Europe/London',
    aliases: ['southampton', 'gbsou', 'sou'],
  },
  'new-york': {
    id: 'new-york',
    name: 'New York',
    nameDe: 'New York',
    lat: 40.6675,
    lng: -74.0742, // Cape Liberty / Bayonne
    tz: 'America/New_York',
    aliases: ['new york', 'nyc', 'usnyc', 'cape liberty', 'bayonne', 'brooklyn', 'manhattan'],
  },
  lisbon: {
    id: 'lisbon',
    name: 'Lisbon',
    nameDe: 'Lissabon',
    lat: 38.7055,
    lng: -9.145,
    tz: 'Europe/Lisbon',
    aliases: ['lisbon', 'lisboa', 'lissabon', 'ptlis'],
  },
  'ponta-delgada': {
    id: 'ponta-delgada',
    name: 'Ponta Delgada',
    nameDe: 'Ponta Delgada',
    lat: 37.7362,
    lng: -25.6681,
    tz: 'Atlantic/Azores',
    aliases: ['ponta delgada', 'azores', 'acores', 'ptpdl', 'pdl'],
  },
  'fort-lauderdale': {
    id: 'fort-lauderdale',
    name: 'Fort Lauderdale',
    nameDe: 'Fort Lauderdale',
    lat: 26.0942,
    lng: -80.115,
    tz: 'America/New_York',
    aliases: ['fort lauderdale', 'port everglades', 'uspef', 'fll'],
  },
  alicante: {
    id: 'alicante',
    name: 'Alicante',
    nameDe: 'Alicante',
    lat: 38.3355,
    lng: -0.4885,
    tz: 'Europe/Madrid',
    aliases: ['alicante', 'esalc', 'alc'],
  },
  malaga: {
    id: 'malaga',
    name: 'Malaga',
    nameDe: 'Málaga',
    lat: 36.7112,
    lng: -4.4184,
    tz: 'Europe/Madrid',
    aliases: ['malaga', 'málaga', 'esagp', 'agp'],
  },
  cadiz: {
    id: 'cadiz',
    name: 'Cadiz',
    nameDe: 'Cádiz (Sevilla)',
    lat: 36.5342,
    lng: -6.2875,
    tz: 'Europe/Madrid',
    aliases: ['cadiz', 'cádiz', 'seville', 'sevilla', 'escad', 'cad'],
  },
}

export function allHarbors(): Harbor[] {
  return Object.values(harbors)
}

export function harborOf(id: string): Harbor {
  const harbor = harbors[id]
  if (!harbor) throw new Error(`Unknown harbor ${id}`)
  return harbor
}

export function findHarbor(id: string): Harbor | undefined {
  return harbors[id]
}

export function harborTz(id: string): string {
  return findHarbor(id)?.tz ?? 'UTC'
}

export function harborIdFromStop(stop: { id: string; name: string; nameDe?: string }): string {
  if (harbors[stop.id]) return stop.id
  const base = stop.id.replace(/-return$/, '')
  if (harbors[base]) return base
  return matchHarbor(stop.name)?.id ?? matchHarbor(stop.nameDe)?.id ?? stop.id
}

export function harborNear(point: GeoPoint, maxKm = 8): Harbor | null {
  let best: Harbor | null = null
  let bestKm = maxKm
  for (const harbor of allHarbors()) {
    const km = haversineKm(point, harbor)
    if (km <= bestKm) {
      best = harbor
      bestKm = km
    }
  }
  return best
}

const COUNTRY_WORDS = new Set([
  'spain',
  'spanien',
  'italy',
  'italien',
  'italia',
  'france',
  'frankreich',
  'germany',
  'deutschland',
  'portugal',
  'greece',
  'griechenland',
  'netherlands',
  'holland',
  'belgium',
  'croatia',
  'kroatien',
  'usa',
  'us',
  'united',
  'states',
  'florida',
  'bahamas',
  'mexico',
  'jamaica',
  'uk',
  'england',
  'brazil',
  'brasil',
])

export function matchHarbor(raw: string | null | undefined): Harbor | null {
  const cleaned = raw?.replace(/@+/g, ' ').replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned.length < 2) return null
  const needle = stripCountries(normalizeHarbor(cleaned))
  if (!needle) return null
  let best: Harbor | null = null
  let bestScore = 0
  for (const harbor of allHarbors()) {
    const score = Math.max(
      ...harborLabels(harbor).map((label) => scoreHarbor(needle, normalizeHarbor(label))),
    )
    if (score > bestScore) {
      best = harbor
      bestScore = score
    }
  }
  return bestScore >= 50 ? best : null
}

function harborLabels(harbor: Harbor): string[] {
  return [harbor.id, harbor.name, harbor.nameDe, ...harbor.aliases]
}

function scoreHarbor(needle: string, hay: string): number {
  if (!hay) return 0
  if (hay === needle) return 100
  const nParts = tokensOf(needle)
  const hParts = tokensOf(hay)
  if (nParts.length && nParts.every((part) => hParts.includes(part))) return 80
  if (hParts.length && hParts.every((part) => nParts.includes(part))) return 75
  if (needle.length >= 4 && hay.includes(needle)) return 70
  if (hay.length >= 5 && needle.includes(hay)) return 60
  const hits = nParts.filter((part) =>
    hParts.some(
      (token) =>
        token === part ||
        (part.length >= 5 && token.length >= 5 && (token.includes(part) || part.includes(token))),
    ),
  ).length
  return hits && hits === nParts.length ? 50 : 0
}

function tokensOf(value: string): string[] {
  return value.split(' ').filter((part) => part.length >= 3)
}

function stripCountries(value: string): string {
  const stripped = value
    .split(' ')
    .filter((part) => !COUNTRY_WORDS.has(part))
    .join(' ')
    .trim()
  return stripped || value
}

function normalizeHarbor(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function harborStop(
  harborId: string,
  stopId: string,
  arriveAt: string,
  departAt: string,
): PortStop {
  const harbor = harborOf(harborId)
  return {
    id: stopId,
    name: harbor.name,
    nameDe: harbor.nameDe,
    lat: harbor.lat,
    lng: harbor.lng,
    arriveAt,
    departAt,
  }
}
