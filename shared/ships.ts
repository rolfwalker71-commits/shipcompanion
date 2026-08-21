import type { CruiseShip, Trip } from './types.ts'

export const CUSTOM_SHIP_ID = 'custom'

export const ships: CruiseShip[] = [
  { id: 'aidabella', name: 'AIDAbella', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247229700', imo: '9362542' },
  { id: 'aidablu', name: 'AIDAblu', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247282800', imo: '9398882' },
  { id: 'aidadiva', name: 'AIDAdiva', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247257400', imo: '9330048' },
  { id: 'aidaluna', name: 'AIDAluna', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247259100', imo: '9330050' },
  { id: 'aidamar', name: 'AIDAmar', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247282900', imo: '9398894' },
  { id: 'aidasol', name: 'AIDAsol', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247294900', imo: '9475135' },
  { id: 'aidastella', name: 'AIDAstella', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247312400', imo: '9601132' },
  { id: 'aidaperla', name: 'AIDAperla', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247361100', imo: '9636965' },
  { id: 'aidaprima', name: 'AIDAprima', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247357300', imo: '9636953' },
  { id: 'aidanova', name: 'AIDAnova', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247389200', imo: '9781865' },
  { id: 'aidacosma', name: 'AIDAcosma', lineId: 'aida', line: 'AIDA Cruises', lineDe: 'AIDA Cruises', mmsi: '247389300', imo: '9781877' },
  { id: 'mein-schiff-1', name: 'Mein Schiff 1', lineId: 'tui', line: 'TUI Cruises', lineDe: 'TUI Mein Schiff', mmsi: '229428000', imo: '9783564' },
  { id: 'mein-schiff-2', name: 'Mein Schiff 2', lineId: 'tui', line: 'TUI Cruises', lineDe: 'TUI Mein Schiff', mmsi: '229429000', imo: '9783576' },
  { id: 'mein-schiff-3', name: 'Mein Schiff 3', lineId: 'tui', line: 'TUI Cruises', lineDe: 'TUI Mein Schiff', mmsi: '229024000', imo: '9646926' },
  { id: 'mein-schiff-4', name: 'Mein Schiff 4', lineId: 'tui', line: 'TUI Cruises', lineDe: 'TUI Mein Schiff', mmsi: '229025000', imo: '9678399' },
  { id: 'mein-schiff-5', name: 'Mein Schiff 5', lineId: 'tui', line: 'TUI Cruises', lineDe: 'TUI Mein Schiff', mmsi: '229026000', imo: '9753197' },
  { id: 'mein-schiff-6', name: 'Mein Schiff 6', lineId: 'tui', line: 'TUI Cruises', lineDe: 'TUI Mein Schiff', mmsi: '229027000', imo: '9606900' },
  { id: 'mein-schiff-7', name: 'Mein Schiff 7', lineId: 'tui', line: 'TUI Cruises', lineDe: 'TUI Mein Schiff', mmsi: '215000000', imo: '9857650' },
  { id: 'oasis', name: 'Oasis of the Seas', lineId: 'rci', line: 'Royal Caribbean', lineDe: 'Royal Caribbean', mmsi: '311020700', imo: '9383936' },
  { id: 'allure', name: 'Allure of the Seas', lineId: 'rci', line: 'Royal Caribbean', lineDe: 'Royal Caribbean', mmsi: '311022800', imo: '9383948' },
  { id: 'harmony', name: 'Harmony of the Seas', lineId: 'rci', line: 'Royal Caribbean', lineDe: 'Royal Caribbean', mmsi: '311000541', imo: '9682875' },
  { id: 'symphony', name: 'Symphony of the Seas', lineId: 'rci', line: 'Royal Caribbean', lineDe: 'Royal Caribbean', mmsi: '311000610', imo: '9744001' },
  { id: 'wonder', name: 'Wonder of the Seas', lineId: 'rci', line: 'Royal Caribbean', lineDe: 'Royal Caribbean', mmsi: '311001016', imo: '9806912' },
  { id: 'legend', name: 'Legend of the Seas', lineId: 'rci', line: 'Royal Caribbean', lineDe: 'Royal Caribbean', mmsi: '311001716', imo: '9888560' },
  { id: 'utopia', name: 'Utopia of the Seas', lineId: 'rci', line: 'Royal Caribbean', lineDe: 'Royal Caribbean', mmsi: '311001516', imo: '9880661' },
  { id: 'msc-world-europa', name: 'MSC World Europa', lineId: 'msc', line: 'MSC Cruises', lineDe: 'MSC Cruises', mmsi: '256424000', imo: '9837420' },
  { id: 'msc-grandiosa', name: 'MSC Grandiosa', lineId: 'msc', line: 'MSC Cruises', lineDe: 'MSC Cruises', mmsi: '247389400', imo: '9803613' },
  { id: 'msc-euribia', name: 'MSC Euribia', lineId: 'msc', line: 'MSC Cruises', lineDe: 'MSC Cruises', mmsi: '256846000', imo: '9907805' },
  { id: 'msc-meraviglia', name: 'MSC Meraviglia', lineId: 'msc', line: 'MSC Cruises', lineDe: 'MSC Cruises', mmsi: '256789000', imo: '9763874' },
  { id: 'msc-bellissima', name: 'MSC Bellissima', lineId: 'msc', line: 'MSC Cruises', lineDe: 'MSC Cruises', mmsi: '256790000', imo: '9763886' },
  { id: 'msc-seaside', name: 'MSC Seaside', lineId: 'msc', line: 'MSC Cruises', lineDe: 'MSC Cruises', mmsi: '247361800', imo: '9745362' },
  { id: 'costa-smeralda', name: 'Costa Smeralda', lineId: 'costa', line: 'Costa Cruises', lineDe: 'Costa Kreuzfahrten', mmsi: '247389500', imo: '9781889' },
  { id: 'costa-toscana', name: 'Costa Toscana', lineId: 'costa', line: 'Costa Cruises', lineDe: 'Costa Kreuzfahrten', mmsi: '247419100', imo: '9781891' },
  { id: 'costa-diadema', name: 'Costa Diadema', lineId: 'costa', line: 'Costa Cruises', lineDe: 'Costa Kreuzfahrten', mmsi: '247353700', imo: '9636886' },
  { id: 'costa-fascinosa', name: 'Costa Fascinosa', lineId: 'costa', line: 'Costa Cruises', lineDe: 'Costa Kreuzfahrten', mmsi: '247229800', imo: '9479852' },
  { id: 'norwegian-prima', name: 'Norwegian Prima', lineId: 'ncl', line: 'Norwegian Cruise Line', lineDe: 'Norwegian Cruise Line', mmsi: '311001151', imo: '9838383' },
  { id: 'norwegian-viva', name: 'Norwegian Viva', lineId: 'ncl', line: 'Norwegian Cruise Line', lineDe: 'Norwegian Cruise Line', mmsi: '311001251', imo: '9838395' },
  { id: 'norwegian-encore', name: 'Norwegian Encore', lineId: 'ncl', line: 'Norwegian Cruise Line', lineDe: 'Norwegian Cruise Line', mmsi: '311000916', imo: '9751509' },
  { id: 'norwegian-bliss', name: 'Norwegian Bliss', lineId: 'ncl', line: 'Norwegian Cruise Line', lineDe: 'Norwegian Cruise Line', mmsi: '311000716', imo: '9751507' },
  { id: 'celebrity-beyond', name: 'Celebrity Beyond', lineId: 'celebrity', line: 'Celebrity Cruises', lineDe: 'Celebrity Cruises', mmsi: '249155000', imo: '9838385' },
  { id: 'celebrity-apex', name: 'Celebrity Apex', lineId: 'celebrity', line: 'Celebrity Cruises', lineDe: 'Celebrity Cruises', mmsi: '249154000', imo: '9838371' },
  { id: 'disney-wish', name: 'Disney Wish', lineId: 'disney', line: 'Disney Cruise Line', lineDe: 'Disney Cruise Line', mmsi: '311001116', imo: '9834357' },
  { id: 'disney-treasure', name: 'Disney Treasure', lineId: 'disney', line: 'Disney Cruise Line', lineDe: 'Disney Cruise Line', mmsi: '311001216', imo: '9834369' },
  { id: 'disney-dream', name: 'Disney Dream', lineId: 'disney', line: 'Disney Cruise Line', lineDe: 'Disney Cruise Line', mmsi: '311038700', imo: '9430090' },
]

export function shipById(id: string): CruiseShip | undefined {
  return ships.find((ship) => ship.id === id)
}

export function cruiseLines(): { id: string; name: string; nameDe: string }[] {
  const seen = new Map<string, { id: string; name: string; nameDe: string }>()
  for (const ship of ships) {
    if (!seen.has(ship.lineId)) {
      seen.set(ship.lineId, { id: ship.lineId, name: ship.line, nameDe: ship.lineDe })
    }
  }
  return [...seen.values()]
}

export function shipsForLine(lineId: string): CruiseShip[] {
  return ships.filter((ship) => ship.lineId === lineId)
}

export function tripShip(trip: Trip): CruiseShip | undefined {
  if (trip.shipId === CUSTOM_SHIP_ID && trip.customShip?.mmsi && trip.customShip.name) {
    return {
      id: CUSTOM_SHIP_ID,
      name: trip.customShip.name,
      lineId: 'custom',
      line: trip.customShip.line || 'Custom',
      lineDe: trip.customShip.lineDe || trip.customShip.line || 'Eigene Angabe',
      mmsi: trip.customShip.mmsi.replace(/\D/g, ''),
      imo: (trip.customShip.imo ?? '').replace(/\D/g, ''),
    }
  }
  return shipById(trip.shipId)
}

export function tripMmsi(trip: Trip): string {
  return tripShip(trip)?.mmsi ?? ''
}

export function tripKey(trip: Trip): string {
  if (trip.id) return trip.id
  const mmsi = tripMmsi(trip)
  return mmsi || trip.shipId
}
