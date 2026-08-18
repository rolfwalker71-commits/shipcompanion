import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Locale, PortStop, SnapshotResponse } from '@shared/types.ts'
import { DISPLAY_TZ, formatClock } from '@shared/time.ts'
import { cn } from '@/lib/utils'
import { BoardPhoto } from './BoardPhoto'

type TodayPanelProps = {
  snapshot: SnapshotResponse
  locale: Locale
  stops: PortStop[]
}

export function TodayPanel({ snapshot, locale, stops }: TodayPanelProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const shipTz = snapshot.shipTz || DISPLAY_TZ
  const homeClock = formatClock(now, locale, DISPLAY_TZ)
  const shipClock = formatClock(now, locale, shipTz)
  const sunrise = snapshot.sun ? formatClock(new Date(snapshot.sun.sunrise), locale, shipTz) : null
  const sunset = snapshot.sun ? formatClock(new Date(snapshot.sun.sunset), locale, shipTz) : null
  const greeting = snapshot.narrative?.trim() || t('narrativeEmpty')
  const progress = t('tripDay', {
    n: tripIndex(stops, snapshot) + 1,
    total: stops.length,
  })

  return (
    <div className="flex min-w-0 items-stretch gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="line-clamp-2 text-sm leading-snug text-foreground sm:text-base">{greeting}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:text-sm">
          <span>
            {t('clockHome')}{' '}
            <span className="font-semibold tabular-nums text-foreground">{homeClock}</span>
          </span>
          <span>
            {t('clockShip')}{' '}
            <span className="font-semibold tabular-nums text-foreground">{shipClock}</span>
          </span>
          {sunrise ? (
            <span className="inline-flex items-center gap-1">
              <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              <span className="font-semibold tabular-nums text-foreground">{sunrise}</span>
            </span>
          ) : null}
          {sunset ? (
            <span className="inline-flex items-center gap-1">
              <Moon className="h-3.5 w-3.5 text-indigo-400" aria-hidden />
              <span className="font-semibold tabular-nums text-foreground">{sunset}</span>
            </span>
          ) : null}
        </div>
        <JourneyBand stops={stops} locale={locale} snapshot={snapshot} dayLabel={progress} />
      </div>
      <div className="flex shrink-0 flex-col items-end justify-center">
        <BoardPhoto />
      </div>
    </div>
  )
}

function JourneyBand({
  stops,
  locale,
  snapshot,
  dayLabel,
}: {
  stops: PortStop[]
  locale: Locale
  snapshot: SnapshotResponse
  dayLabel: string
}) {
  const { t } = useTranslation()
  const now = Date.now()
  const currentName = snapshot.nextPort.atPort
    ? snapshot.nextPort.berthName ?? snapshot.nextPort.name
    : snapshot.nextPort.name

  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-medium text-muted-foreground sm:text-xs">{dayLabel}</p>
      <ol
        className="flex min-h-11 items-center gap-1 overflow-x-auto overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={t('journeyBand')}
      >
        {stops.map((stop) => {
          const name = locale === 'de' ? stop.nameDe || stop.name : stop.name
          const arrive = new Date(stop.arriveAt).getTime()
          const depart = new Date(stop.departAt).getTime()
          const current =
            now >= arrive && now <= depart + 2 * 60 * 60 * 1000
              ? true
              : currentName === name
          const past = now > depart && !current
          return (
            <li key={stop.id} className="flex min-w-8 flex-1 flex-col items-center gap-0.5">
              <span
                className={cn(
                  'size-2.5 rounded-full',
                  current ? 'size-3 bg-primary' : past ? 'bg-foreground/70' : 'bg-muted-foreground/35',
                )}
              />
              <span
                className={cn(
                  'max-w-14 truncate text-center text-[10px] leading-none',
                  current ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {name}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function tripIndex(stops: PortStop[], snapshot: SnapshotResponse): number {
  if (!stops.length) return 0
  const now = Date.now()
  let index = stops.findIndex(
    (stop) => now >= new Date(stop.arriveAt).getTime() && now <= new Date(stop.departAt).getTime(),
  )
  if (index < 0) {
    index = stops.findIndex((stop) => now < new Date(stop.arriveAt).getTime())
    if (index < 0) index = stops.length - 1
  }
  return index
}
