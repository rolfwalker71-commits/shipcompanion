import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SnapshotResponse, Trip, PortStop } from '@shared/types.ts'
import { tripShip } from '@shared/ships.ts'
import { useAuth } from '@/lib/auth'
import { ShipMap, type MapPort } from './ShipMap'
import { StatusStrip } from './StatusStrip'

type HomeViewProps = {
  trip: Trip
}

export function HomeView({ trip }: HomeViewProps) {
  const { i18n } = useTranslation()
  const { logout } = useAuth()
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null)
  const [error, setError] = useState(false)
  const locale = i18n.language.startsWith('de') ? 'de' : 'en'
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

  const position = useMemo(() => {
    if (snapshot?.position) return snapshot.position
    const stop = trip.stops[0]
    return stop ? { lat: stop.lat, lng: stop.lng } : { lat: 41.9, lng: 5.2 }
  }, [snapshot?.position, trip.stops])

  const path = snapshot?.path ?? trip.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))
  const track = snapshot?.track ?? []
  const forecast = snapshot?.forecast ?? []

  const ports = useMemo(() => classifyPorts(trip.stops, locale, snapshot), [locale, snapshot, trip.stops])

  const live = snapshot?.tracking === 'live'
  const estimated =
    snapshot?.tracking === 'estimated' ||
    snapshot?.tracking === 'last-known' ||
    snapshot?.tracking === 'no-signal'

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 z-0">
        <ShipMap
          position={position}
          path={path}
          track={track}
          forecast={forecast}
          ports={ports}
          heading={live ? snapshot?.motion?.heading ?? null : null}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-4 pt-2 sm:px-6">
        <StatusStrip
          snapshot={snapshot}
          error={error}
          locale={locale}
          live={live}
          estimated={estimated}
        />
      </div>
    </div>
  )
}

function classifyPorts(
  stops: PortStop[],
  locale: 'de' | 'en',
  snapshot: SnapshotResponse | null,
): MapPort[] {
  const now = Date.now()
  const berthName = snapshot?.nextPort.atPort ? snapshot.nextPort.berthName : null
  let markedNext = false
  return stops.map((stop) => {
    const name = locale === 'de' ? stop.nameDe || stop.name : stop.name
    const arrive = new Date(stop.arriveAt).getTime()
    const depart = new Date(stop.departAt).getTime()
    const isBerth =
      Boolean(berthName) &&
      berthName === name &&
      now >= arrive - 12 * 60 * 60 * 1000 &&
      now <= depart + 12 * 60 * 60 * 1000
    let kind: MapPort['kind']
    if (isBerth || (now >= arrive && now <= depart)) kind = 'current'
    else if (now > depart) kind = 'past'
    else if (!markedNext) {
      kind = 'next'
      markedNext = true
    } else kind = 'later'
    return {
      id: stop.id,
      name,
      lat: stop.lat,
      lng: stop.lng,
      when: formatMapArrival(stop.arriveAt, locale),
      kind,
    }
  })
}

function formatArrival(iso: string, locale: 'de' | 'en'): string {
  const date = new Date(iso)
  const now = new Date()
  const time = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  if (locale === 'de') {
    if (sameDay) return `heute ${time}`
    if (isTomorrow) return `morgen ${time}`
  } else {
    if (sameDay) return `today ${time}`
    if (isTomorrow) return `tomorrow ${time}`
  }
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatMapArrival(iso: string, locale: 'de' | 'en'): string {
  const relative = formatArrival(iso, locale)
  if (
    relative.startsWith('heute') ||
    relative.startsWith('morgen') ||
    relative.startsWith('today') ||
    relative.startsWith('tomorrow')
  ) {
    return relative
  }
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
