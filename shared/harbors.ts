import type { PortStop } from './types.ts'

/** Cruise berth / passenger terminal — not the city centroid. */
export type Harbor = {
  id: string
  name: string
  nameDe: string
  lat: number
  lng: number
  aliases: string[]
}

const harbors: Record<string, Harbor> = {
  barcelona: {
    id: 'barcelona',
    name: 'Barcelona',
    nameDe: 'Barcelona',
    lat: 41.355,
    lng: 2.178, // Moll Adossat, Terminal C/D
    aliases: ['barcelona', 'esbcn', 'bcn'],
  },
  palma: {
    id: 'palma',
    name: 'Palma de Mallorca',
    nameDe: 'Palma de Mallorca',
    lat: 39.5572,
    lng: 2.6305, // Moll de Ponent / Estació Marítima
    aliases: ['palma', 'mallorca', 'espmi', 'pmi'],
  },
  'la-spezia': {
    id: 'la-spezia',
    name: 'La Spezia',
    nameDe: 'La Spezia',
    lat: 44.106,
    lng: 9.8325, // Molo Garibaldi, west quay
    aliases: ['la spezia', 'spezia', 'lt spezia', 'lt spe', 'laspezia', 'itspe', 'it spe'],
  },
  civitavecchia: {
    id: 'civitavecchia',
    name: 'Civitavecchia',
    nameDe: 'Civitavecchia (Rom)',
    lat: 42.0925,
    lng: 11.786, // Roma Cruise Terminal, quays 12–13
    aliases: ['civitavecchia', 'itcvv', 'rome', 'roma', 'cvv'],
  },
  naples: {
    id: 'naples',
    name: 'Naples',
    nameDe: 'Neapel',
    lat: 40.8378,
    lng: 14.2565, // Stazione Marittima / Molo Angioino
    aliases: ['naples', 'napoli', 'neapel', 'itnap', 'nap'],
  },
  'las-palmas': {
    id: 'las-palmas',
    name: 'Las Palmas',
    nameDe: 'Las Palmas',
    lat: 28.1422,
    lng: -15.4245, // Muelle Santa Catalina
    aliases: ['las palmas', 'gran canaria', 'eslpa', 'lpa'],
  },
  tenerife: {
    id: 'tenerife',
    name: 'Santa Cruz de Tenerife',
    nameDe: 'Santa Cruz de Tenerife',
    lat: 28.4765,
    lng: -16.2415, // Muelle Norte cruise piers
    aliases: ['tenerife', 'santa cruz', 'essct', 'tci'],
  },
  funchal: {
    id: 'funchal',
    name: 'Funchal',
    nameDe: 'Funchal',
    lat: 32.6419,
    lng: -16.9101, // Gare Marítima da Pontinha
    aliases: ['funchal', 'madeira', 'ptfnc'],
  },
  miami: {
    id: 'miami',
    name: 'Miami',
    nameDe: 'Miami',
    lat: 25.7785,
    lng: -80.177, // PortMiami, Dodge Island
    aliases: ['miami', 'usmia', 'portmiami'],
  },
  nassau: {
    id: 'nassau',
    name: 'Nassau',
    nameDe: 'Nassau',
    lat: 25.0798,
    lng: -77.3424, // Prince George Wharf
    aliases: ['nassau', 'bsnas'],
  },
  cozumel: {
    id: 'cozumel',
    name: 'Cozumel',
    nameDe: 'Cozumel',
    lat: 20.4759,
    lng: -86.9748, // Puerta Maya
    aliases: ['cozumel', 'mxczm', 'san miguel'],
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
