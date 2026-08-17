import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale, SnapshotResponse, Trip } from '@shared/types.ts'
import { tripShip } from '@shared/ships.ts'
import { useAuth } from '@/lib/auth'

export function useSnapshot(trip: Trip) {
  const { i18n } = useTranslation()
  const { logout } = useAuth()
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null)
  const [error, setError] = useState(false)
  const locale: Locale = i18n.language.startsWith('de') ? 'de' : 'en'
  const ship = tripShip(trip)
  const atPort = snapshot?.nextPort.atPort ?? false

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!ship) return
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
      }
    }

    void load().catch(() => {
      if (!cancelled) setError(true)
    })
    const timer = window.setInterval(() => {
      void load().catch(() => {
        if (!cancelled) setError(true)
      })
    }, atPort ? 10_000 : 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [atPort, locale, logout, ship, trip.stops])

  const live = snapshot?.tracking === 'live'
  const estimated =
    snapshot?.tracking === 'estimated' ||
    snapshot?.tracking === 'last-known' ||
    snapshot?.tracking === 'no-signal'

  return { snapshot, error, locale, live, estimated }
}
