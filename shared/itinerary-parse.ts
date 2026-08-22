import { matchHarbor } from './harbors.ts'

export type ParsedItineraryStop = {
  harborId: string
  label: string
  arriveDate: string
  arriveTime: string
  departDate: string
  departTime: string
}

export type ParseItineraryResult = {
  stops: ParsedItineraryStop[]
  skippedSea: number
  unmatched: string[]
  source?: 'llm' | 'local'
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  janr: 1,
  januar: 1,
  februar: 2,
  maerz: 3,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
}

const DATE_RE = /\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|OKT|DEZ)[A-ZÄÖÜ]*\b/gi
const TIME_RE = /\b(\d{1,2}):(\d{1,2})\b/g
const PORT_RE =
  /\b([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß .'-]{2,}?(?:\s*\([^)]+\))?)\s*,\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß .'-]{2,})\b/g
const SEA_RE = /^cruisi?n+g$/i
const JUNK_RE =
  /ortszeit|arrangements|flug|reist mit|unterrichtung|pauschalreise|bürgerlichen|kreuzfahrtverlauf|ankunft|abfahrt|gast\b|ticket/i

export function parseItineraryPaste(text: string, yearHint?: string): ParseItineraryResult {
  const empty: ParseItineraryResult = { stops: [], skippedSea: 0, unmatched: [] }
  if (!text.trim()) return empty
  const lined = parseLined(text, yearHint)
  if (lined.stops.length) return lined
  return parseRcclBlocks(text, yearHint)
}

function parseLined(text: string, yearHint?: string): ParseItineraryResult {
  const rows: { month: number; day: number; label: string; times: string[] }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || JUNK_RE.test(line)) continue
    const date = firstDate(line)
    if (!date) continue
    const rest = line.slice(date.index + date.raw.length).trim()
    if (!rest) continue
    const times = allTimes(rest)
    const label = rest.replace(TIME_RE, '').replace(/\s+/g, ' ').trim()
    if (!label || SEA_RE.test(cleanSea(label))) continue
    rows.push({ month: date.month, day: date.day, label, times })
  }
  if (rows.length < 2) return { stops: [], skippedSea: 0, unmatched: [] }
  return toStops(
    rows.map((row, index) => ({
      ...row,
      year: yearsFor(rows.map((item) => item.month), yearHint)[index],
    })),
  )
}

function parseRcclBlocks(text: string, yearHint?: string): ParseItineraryResult {
  const dates = [...text.matchAll(DATE_RE)].map((match) => ({
    day: Number(match[1]),
    month: monthNum(match[2]),
    raw: match[0],
  }))
  const labels = extractLabels(text)
  const seaCount = labels.filter((label) => isSea(label)).length
  const times = allTimes(text)
  if (!dates.length || !labels.some((label) => !isSea(label))) {
    return { stops: [], skippedSea: seaCount, unmatched: [] }
  }

  const years = yearsFor(
    dates.map((date) => date.month),
    yearHint,
  )
  const days = dates.map((date, index) => ({
    year: years[index],
    month: date.month,
    day: date.day,
    label: labels[index] ?? '',
    times: [] as string[],
  }))

  if (labels.length !== dates.length) {
    const ports = labels.filter((label) => !isSea(label))
    const lastPort = ports.at(-1) ?? ''
    const head = ports.slice(0, -1)
    for (let i = 0; i < days.length; i += 1) {
      if (i < head.length) days[i].label = head[i] ?? 'CRUISING'
      else if (i === days.length - 1) days[i].label = lastPort
      else days[i].label = 'CRUISING'
    }
  }

  const land = days.filter((day) => day.label && !isSea(day.label))
  const arrives = land.length ? times.slice(0, Math.max(0, land.length - 1)) : []
  const departs = land.length ? times.slice(arrives.length) : []
  // First land day has depart only; last has arrive only; middle have both.
  // Times usually: all arrivals (minus embarkation) then all departures (minus final).
  let arriveCursor = 0
  let departCursor = 0
  const withTimes = land.map((day, index) => {
    const first = index === 0
    const last = index === land.length - 1
    const arrive = first ? null : (arrives[arriveCursor++] ?? null)
    const depart = last ? null : (departs[departCursor++] ?? arrives[arriveCursor - 1] ?? null)
    const timesForDay = [arrive, depart].filter((item): item is string => Boolean(item))
    return { ...day, times: timesForDay }
  })

  return toStops(withTimes, seaCount + days.filter((day) => isSea(day.label)).length)
}

function extractLabels(text: string): string[] {
  const combined = new RegExp(`${PORT_RE.source}|\\bCRUISI?N+G\\b`, 'gi')
  const labels: string[] = []
  for (const match of text.matchAll(combined)) {
    const label = match[1] && match[2] ? `${match[1].trim()}, ${match[2].trim()}` : match[0]
    if (JUNK_RE.test(label)) continue
    labels.push(label)
  }
  return labels
}

function toStops(
  rows: { year: number; month: number; day: number; label: string; times: string[] }[],
  extraSea = 0,
): ParseItineraryResult {
  const stops: ParsedItineraryStop[] = []
  const unmatched: string[] = []
  let skippedSea = extraSea
  for (const row of rows) {
    if (!row.label || isSea(row.label)) {
      skippedSea += 1
      continue
    }
    const harbor = matchHarbor(row.label) ?? matchHarbor(row.label.split(',')[0] ?? '')
    if (!harbor) {
      unmatched.push(row.label)
      continue
    }
    const ymd = `${row.year}-${pad(row.month)}-${pad(row.day)}`
    const arriveTime = row.times.length >= 2 ? row.times[0] : row.times.length === 1 ? row.times[0] : '08:00'
    const departTime = row.times.length >= 2 ? row.times[1] : row.times.length === 1 ? row.times[0] : '17:00'
    // Embarkation: only a departure was published.
    const first = stops.length === 0
    const publishedArrive = first && row.times.length === 1 ? '08:00' : arriveTime
    const publishedDepart = !first && row.times.length === 1 ? '17:00' : departTime
    stops.push({
      harborId: harbor.id,
      label: row.label,
      arriveDate: ymd,
      arriveTime: first && row.times.length === 1 ? '08:00' : publishedArrive,
      departDate: ymd,
      departTime: first && row.times.length === 1 ? row.times[0] : publishedDepart,
    })
  }
  // Last call often has only arrival.
  if (stops.length >= 2) {
    const last = stops[stops.length - 1]
    const lastRow = rows.filter((row) => row.label && !isSea(row.label)).at(-1)
    if (lastRow && lastRow.times.length === 1) {
      last.arriveTime = lastRow.times[0]
      last.departTime = '17:00'
    }
  }
  return { stops, skippedSea, unmatched }
}

function firstDate(line: string): { day: number; month: number; raw: string; index: number } | null {
  DATE_RE.lastIndex = 0
  const match = DATE_RE.exec(line)
  if (!match) return null
  return { day: Number(match[1]), month: monthNum(match[2]), raw: match[0], index: match.index }
}

function allTimes(text: string): string[] {
  return [...text.matchAll(TIME_RE)].map((match) => `${pad(Number(match[1]))}:${pad(Number(match[2]))}`)
}

function yearsFor(months: number[], yearHint?: string): number[] {
  const hintYear = Number((yearHint ?? '').slice(0, 4))
  let year = Number.isFinite(hintYear) && hintYear > 1990 ? hintYear : new Date().getFullYear()
  let prev = months[0] ?? 1
  return months.map((month, index) => {
    if (index && month < prev) year += 1
    prev = month
    return year
  })
}

function monthNum(token: string): number {
  const key = token
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .slice(0, 3)
  if (key === 'okt') return 10
  if (key === 'dez') return 12
  return MONTHS[key] ?? MONTHS[token.toLowerCase()] ?? 1
}

function isSea(label: string): boolean {
  return SEA_RE.test(cleanSea(label))
}

function cleanSea(label: string): string {
  return label.replace(/[^a-z]/gi, '')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
