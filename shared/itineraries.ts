import type { ItineraryPreset, PortStop } from './types.ts'
import { shiftStopsToStart } from './geo.ts'
import { harborStop } from './harbors.ts'

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
    harborStop('barcelona', 'barcelona', at('2026-08-16T08:00:00+02:00'), at('2026-08-16T17:00:00+02:00')),
    harborStop('palma', 'palma', at('2026-08-17T08:00:00+02:00'), at('2026-08-17T18:00:00+02:00')),
    harborStop('la-spezia', 'la-spezia', at('2026-08-19T06:30:00+02:00'), at('2026-08-19T20:00:00+02:00')),
    harborStop('civitavecchia', 'civitavecchia', at('2026-08-20T07:00:00+02:00'), at('2026-08-20T20:00:00+02:00')),
    harborStop('naples', 'naples', at('2026-08-21T07:00:00+02:00'), at('2026-08-21T19:00:00+02:00')),
    harborStop('barcelona', 'barcelona-return', at('2026-08-23T05:00:00+02:00'), at('2026-08-23T17:00:00+02:00')),
  ]
}

function canariesStops(): PortStop[] {
  return [
    harborStop('las-palmas', 'las-palmas', iso(-3, 8), iso(-3, 18)),
    harborStop('tenerife', 'tenerife', iso(-1, 9), iso(-1, 18)),
    harborStop('funchal', 'funchal', iso(1, 8), iso(1, 17)),
    harborStop('las-palmas', 'las-palmas-return', iso(3, 8), iso(3, 18)),
  ]
}

function caribbeanStops(): PortStop[] {
  return [
    harborStop('miami', 'miami', iso(-4, 7), iso(-4, 16)),
    harborStop('nassau', 'nassau', iso(-2, 8), iso(-2, 17)),
    harborStop('cozumel', 'cozumel', iso(1, 8), iso(1, 17)),
    harborStop('miami', 'miami-return', iso(3, 7), iso(3, 16)),
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
