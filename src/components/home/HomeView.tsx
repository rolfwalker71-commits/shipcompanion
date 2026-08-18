import { useMemo } from 'react'
import type { SnapshotResponse, Trip, PortStop } from '@shared/types.ts'
import { formatMapWhen } from '@shared/time.ts'
import { useSnapshot } from '@/lib/use-snapshot'
import { ShipMap, type MapPort } from './ShipMap'
import { StatusStrip } from './StatusStrip'

type HomeViewProps = {
  trip: Trip
}

export function HomeView({ trip }: HomeViewProps) {
  const { snapshot, error, locale, live, estimated } = useSnapshot(trip)

  const position = useMemo(() => {
    if (snapshot?.position) return snapshot.position
    const stop = trip.stops[0]
    return stop ? { lat: stop.lat, lng: stop.lng } : { lat: 41.9, lng: 5.2 }
  }, [snapshot?.position, trip.stops])

  const path = snapshot?.path ?? trip.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))
  const track = snapshot?.track ?? []
  const gap = snapshot?.gap ?? []
  const forecast = snapshot?.forecast ?? []

  const ports = useMemo(() => classifyPorts(trip.stops, locale, snapshot), [locale, snapshot, trip.stops])

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 z-0">
        <ShipMap
          position={position}
          path={path}
          track={track}
          gap={gap}
          forecast={forecast}
          ports={ports}
          heading={snapshot?.motion?.heading ?? null}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-10 w-full px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-2 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <StatusStrip
            snapshot={snapshot}
            error={error}
            locale={locale}
            live={live}
            estimated={estimated}
          />
        </div>
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
      when: formatMapWhen(stop.arriveAt, locale),
      kind,
    }
  })
}
