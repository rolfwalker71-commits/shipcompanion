export type ShipFacts = {
  built: number
  lengthM: number
  beamM?: number
  passengers: number
  crew?: number
  gt?: number
  className: string
  classNameDe: string
}

const facts: Record<string, ShipFacts> = {
  legend: {
    built: 2026,
    lengthM: 365,
    beamM: 66,
    passengers: 5610,
    crew: 2350,
    gt: 248663,
    className: 'Icon class',
    classNameDe: 'Icon-Klasse',
  },
  oasis: {
    built: 2009,
    lengthM: 360,
    passengers: 5492,
    crew: 2394,
    gt: 226838,
    className: 'Oasis class',
    classNameDe: 'Oasis-Klasse',
  },
  allure: {
    built: 2010,
    lengthM: 360,
    passengers: 5492,
    crew: 2384,
    gt: 225282,
    className: 'Oasis class',
    classNameDe: 'Oasis-Klasse',
  },
  harmony: {
    built: 2016,
    lengthM: 362,
    passengers: 5497,
    crew: 2394,
    gt: 226963,
    className: 'Oasis class',
    classNameDe: 'Oasis-Klasse',
  },
  symphony: {
    built: 2018,
    lengthM: 361,
    passengers: 5518,
    crew: 2200,
    gt: 228081,
    className: 'Oasis class',
    classNameDe: 'Oasis-Klasse',
  },
  wonder: {
    built: 2022,
    lengthM: 362,
    passengers: 5734,
    crew: 2390,
    gt: 235600,
    className: 'Oasis class',
    classNameDe: 'Oasis-Klasse',
  },
  utopia: {
    built: 2024,
    lengthM: 362,
    passengers: 5668,
    crew: 2290,
    gt: 236473,
    className: 'Oasis class',
    classNameDe: 'Oasis-Klasse',
  },
  aidanova: {
    built: 2018,
    lengthM: 337,
    passengers: 5228,
    crew: 1500,
    gt: 183858,
    className: 'Excellence class',
    classNameDe: 'Excellence-Klasse',
  },
  aidacosma: {
    built: 2021,
    lengthM: 337,
    passengers: 5228,
    crew: 1500,
    gt: 183774,
    className: 'Excellence class',
    classNameDe: 'Excellence-Klasse',
  },
  aidaprima: {
    built: 2016,
    lengthM: 300,
    passengers: 3286,
    crew: 900,
    gt: 125572,
    className: 'Hyperion class',
    classNameDe: 'Hyperion-Klasse',
  },
  aidaperla: {
    built: 2017,
    lengthM: 300,
    passengers: 3286,
    crew: 900,
    gt: 125572,
    className: 'Hyperion class',
    classNameDe: 'Hyperion-Klasse',
  },
}

export function factsForShip(id: string): ShipFacts | undefined {
  return facts[id]
}
