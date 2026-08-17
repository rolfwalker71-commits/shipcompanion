import type { ItineraryPreset, PortStop } from './types.ts'
import { shiftStopsToStart } from './geo.ts'

function iso(daysFromToday: number, hour: number, minute = 0): string {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  date.setDate(date.getDate() + daysFromToday)
  return date.toISOString()
}

function at(local: string): string {
  return new Date(local).toISOString()
}

function legendWestMedStops(): PortStop[] {
  return [
    {
      id: 'barcelona',
      name: 'Barcelona',
      nameDe: 'Barcelona',
      lat: 41.3548,
      lng: 2.1686,
      arriveAt: at('2026-08-16T08:00:00+02:00'),
      departAt: at('2026-08-16T17:00:00+02:00'),
    },
    {
      id: 'palma',
      name: 'Palma de Mallorca',
      nameDe: 'Palma de Mallorca',
      lat: 39.5696,
      lng: 2.6502,
      arriveAt: at('2026-08-17T08:00:00+02:00'),
      departAt: at('2026-08-17T18:00:00+02:00'),
    },
    {
      id: 'la-spezia',
      name: 'La Spezia',
      nameDe: 'La Spezia',
      lat: 44.1024,
      lng: 9.8248,
      arriveAt: at('2026-08-19T06:30:00+02:00'),
      departAt: at('2026-08-19T20:00:00+02:00'),
    },
    {
      id: 'civitavecchia',
      name: 'Civitavecchia',
      nameDe: 'Civitavecchia (Rom)',
      lat: 42.0938,
      lng: 11.7968,
      arriveAt: at('2026-08-20T07:00:00+02:00'),
      departAt: at('2026-08-20T20:00:00+02:00'),
    },
    {
      id: 'naples',
      name: 'Naples',
      nameDe: 'Neapel',
      lat: 40.8364,
      lng: 14.2578,
      arriveAt: at('2026-08-21T07:00:00+02:00'),
      departAt: at('2026-08-21T19:00:00+02:00'),
    },
    {
      id: 'barcelona-return',
      name: 'Barcelona',
      nameDe: 'Barcelona',
      lat: 41.3548,
      lng: 2.1686,
      arriveAt: at('2026-08-23T05:00:00+02:00'),
      departAt: at('2026-08-23T17:00:00+02:00'),
    },
  ]
}

function canariesStops(): PortStop[] {
  return [
    {
      id: 'las-palmas',
      name: 'Las Palmas',
      nameDe: 'Las Palmas',
      lat: 28.1235,
      lng: -15.4363,
      arriveAt: iso(-3, 8),
      departAt: iso(-3, 18),
    },
    {
      id: 'tenerife',
      name: 'Santa Cruz de Tenerife',
      nameDe: 'Santa Cruz de Tenerife',
      lat: 28.4636,
      lng: -16.2518,
      arriveAt: iso(-1, 9),
      departAt: iso(-1, 18),
    },
    {
      id: 'funchal',
      name: 'Funchal',
      nameDe: 'Funchal',
      lat: 32.6669,
      lng: -16.9241,
      arriveAt: iso(1, 8),
      departAt: iso(1, 17),
    },
    {
      id: 'las-palmas-return',
      name: 'Las Palmas',
      nameDe: 'Las Palmas',
      lat: 28.1235,
      lng: -15.4363,
      arriveAt: iso(3, 8),
      departAt: iso(3, 18),
    },
  ]
}

function caribbeanStops(): PortStop[] {
  return [
    {
      id: 'miami',
      name: 'Miami',
      nameDe: 'Miami',
      lat: 25.7743,
      lng: -80.1937,
      arriveAt: iso(-4, 7),
      departAt: iso(-4, 16),
    },
    {
      id: 'nassau',
      name: 'Nassau',
      nameDe: 'Nassau',
      lat: 25.0443,
      lng: -77.3504,
      arriveAt: iso(-2, 8),
      departAt: iso(-2, 17),
    },
    {
      id: 'cozumel',
      name: 'Cozumel',
      nameDe: 'Cozumel',
      lat: 20.5083,
      lng: -86.9458,
      arriveAt: iso(1, 8),
      departAt: iso(1, 17),
    },
    {
      id: 'miami-return',
      name: 'Miami',
      nameDe: 'Miami',
      lat: 25.7743,
      lng: -80.1937,
      arriveAt: iso(3, 7),
      departAt: iso(3, 16),
    },
  ]
}

export function itineraryPresets(): ItineraryPreset[] {
  return [
    {
      id: 'west-med',
      title: 'Western Mediterranean (Legend, 16–23 Aug)',
      titleDe: 'Westliches Mittelmeer (Legend, 16.–23. Aug.)',
      shipId: 'legend',
      stops: legendWestMedStops(),
    },
    {
      id: 'canaries',
      title: 'Canary Islands',
      titleDe: 'Kanarische Inseln',
      shipId: 'mein-schiff-7',
      stops: canariesStops(),
    },
    {
      id: 'caribbean',
      title: 'Caribbean',
      titleDe: 'Karibik',
      shipId: 'symphony',
      stops: caribbeanStops(),
    },
  ]
}

export function presetById(id: string): ItineraryPreset | undefined {
  return itineraryPresets().find((preset) => preset.id === id)
}

export function stopsForTrip(presetId: string, startDate: string): PortStop[] {
  const preset = presetById(presetId) ?? itineraryPresets()[0]
  return shiftStopsToStart(preset.stops, startDate)
}
