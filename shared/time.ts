import type { Locale } from './types.ts'

/** Family display zone: CEST (UTC+2) in summer, CET (UTC+1) in winter. */
export const DISPLAY_TZ = 'Europe/Berlin'

function ymd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return ymd(new Date(Date.UTC(year, month - 1, date + days)), 'UTC')
}

function clock(date: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function utcOffsetLabel(date: Date): string {
  const raw = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TZ,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  if (raw) return raw.replace('GMT', 'UTC')
  return 'UTC+2'
}

function relativeHead(date: Date, locale: Locale): string | null {
  const day = ymd(date, DISPLAY_TZ)
  const today = ymd(new Date(), DISPLAY_TZ)
  const localClock = clock(date, locale, DISPLAY_TZ)
  if (day === today) return locale === 'de' ? `heute ${localClock}` : `today ${localClock}`
  if (day === addCalendarDays(today, 1)) {
    return locale === 'de' ? `morgen ${localClock}` : `tomorrow ${localClock}`
  }
  return null
}

function stamp(head: string, date: Date, withUtc: boolean): string {
  const offset = utcOffsetLabel(date)
  if (!withUtc) return `${head} ${offset}`
  return `${head} ${offset} (${clock(date, 'de', 'UTC')} UTC)`
}

/** Status times: Europe/Berlin, optionally with UTC in parentheses. */
export function formatWhen(iso: string, locale: Locale, withUtc = false): string {
  const date = new Date(iso)
  const relative = relativeHead(date, locale)
  if (relative) return stamp(relative, date, withUtc)
  const dated = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: DISPLAY_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return stamp(dated, date, withUtc)
}

export function formatSeen(iso: string, locale: Locale): string {
  const date = new Date(iso)
  const local = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: DISPLAY_TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return stamp(local, date, true)
}

/** Compact map-pin times in Europe/Berlin, without UTC. */
export function formatMapWhen(iso: string, locale: Locale): string {
  const date = new Date(iso)
  const relative = relativeHead(date, locale)
  if (relative) return relative
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: DISPLAY_TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}
