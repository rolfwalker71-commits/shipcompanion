import type { AisNavState, Locale, PortStop } from './types.ts'
import { matchHarbor } from './harbors.ts'

export type AisEtaParts = {
  month: number
  day: number
  hour: number
  minute: number
}

export function navStateFromAis(status: number | null | undefined, sog: number | null | undefined): AisNavState {
  if (status === 5) return 'moored'
  if (status === 1) return 'anchored'
  if (status === 6) return 'aground'
  if (status === 2 || status === 3 || status === 4) return 'restricted'
  if (status === 0 || status === 8) return 'underway'
  if (sog != null) {
    if (sog < 0.8) return 'moored'
    if (sog >= 2.5) return 'underway'
  }
  return 'unknown'
}

export function isStoppedNav(nav: AisNavState): boolean {
  return nav === 'moored' || nav === 'anchored' || nav === 'aground'
}

export function isUnderwayNav(nav: AisNavState): boolean {
  return nav === 'underway' || nav === 'restricted'
}

export function cleanAisDestination(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/@+/g, ' ').replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned.length < 2) return null
  if (/^(n\/?a|unknown|none|not available)$/i.test(cleaned)) return null
  return cleaned
}

export function prettyAisDestination(raw: string): string {
  if (raw !== raw.toUpperCase() || raw.length < 3) return raw
  return raw
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (match) => match.toUpperCase())
}

export function parseAisEta(parts: AisEtaParts | null | undefined, now = new Date()): string | null {
  if (!parts || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null
  const hour = parts.hour >= 0 && parts.hour < 24 ? parts.hour : 0
  const minute = parts.minute >= 0 && parts.minute < 60 ? parts.minute : 0
  const year = now.getUTCFullYear()
  let stamp = Date.UTC(year, parts.month - 1, parts.day, hour, minute)
  if (stamp < now.getTime() - 2 * 86_400_000) {
    stamp = Date.UTC(year + 1, parts.month - 1, parts.day, hour, minute)
  }
  return new Date(stamp).toISOString()
}

export function resolveAisDestination(
  raw: string | null | undefined,
  stops: PortStop[],
  locale: Locale,
): string | null {
  const cleaned = cleanAisDestination(raw)
  if (!cleaned) return null
  const harbor = matchHarbor(cleaned)
  if (harbor) return locale === 'de' ? harbor.nameDe : harbor.name
  const needle = cleaned
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const stop = stops.find((item) => {
    const hay = `${item.name} ${item.nameDe}`
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    return hay.includes(needle) || needle.includes(hay)
  })
  if (stop) return locale === 'de' ? stop.nameDe : stop.name
  return prettyAisDestination(cleaned)
}
