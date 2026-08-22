import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale, SnapshotResponse, Trip } from '@shared/types.ts'
import { tripShip } from '@shared/ships.ts'
import { useAuth } from '@/lib/auth'
import { scheduleSnapshot } from '@/lib/local-snapshot'

function cacheKey(mmsi: string): string {
  return `cruise-snapshot:${mmsi}`
}

function readCached(mmsi: string): SnapshotResponse | null {
  try {
    const raw = localStorage.getItem(cacheKey(mmsi)) ?? sessionStorage.getItem(cacheKey(mmsi))
    if (!raw) return null
    return JSON.parse(raw) as SnapshotResponse
  } catch {
    return null
  }
}

function writeCached(mmsi: string, snapshot: SnapshotResponse): void {
  try {
    localStorage.setItem(cacheKey(mmsi), JSON.stringify(snapshot))
  } catch {
    /* quota */
  }
}

export function useSnapshot(trip: Trip) {
  const { i18n } = useTranslation()
  const { logout } = useAuth()
  const locale: Locale = i18n.language.startsWith('de') ? 'de' : 'en'
  const ship = tripShip(trip)
  const local = useMemo(() => scheduleSnapshot(trip, locale), [locale, trip])
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(() =>
    ship ? readCached(ship.mmsi) : null,
  )
  const [error, setError] = useState(false)
  const shown = snapshot ?? local
  const atPort = shown?.nextPort.atPort ?? false

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!ship) return
      let lastError: unknown = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const res = await fetch('/api/snapshot', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mmsi: ship.mmsi,
              imo: ship.imo || undefined,
              shipName: ship.name,
              locale,
              stops: trip.stops,
            }),
          })
          if (res.status === 401) {
            await logout()
            return
          }
          if (!res.ok) throw new Error('snapshot failed')
          const data = (await res.json()) as SnapshotResponse
          if (!cancelled) {
            setSnapshot(data)
            setError(false)
            writeCached(ship.mmsi, data)
          }
          return
        } catch (cause) {
          lastError = cause
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
        }
      }
      if (!cancelled && lastError) setError(true)
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, atPort ? 10_000 : 30_000)
    const onRefresh = () => {
      void load()
    }
    window.addEventListener('shiptracker:refresh', onRefresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('shiptracker:refresh', onRefresh)
    }
  }, [atPort, locale, logout, ship, trip.stops])

  const live = shown?.tracking === 'live'
  const estimated =
    shown?.tracking === 'estimated' ||
    shown?.tracking === 'last-known' ||
    shown?.tracking === 'no-signal'

  return { snapshot: shown, error, locale, live, estimated }
}
