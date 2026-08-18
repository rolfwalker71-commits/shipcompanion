import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Gauge, MapPinned, RadioTower, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CruiseShip, PortStop, SnapshotResponse, WeatherInfo } from '@shared/types.ts'
import { DISPLAY_TZ, formatArrivalParts, formatClock, formatSeen } from '@shared/time.ts'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ShipFactsDialog } from './ShipFactsDialog'
import { TodayPanel } from './TodayPanel'

const PAGE_COUNT = 2

type StatusStripProps = {
  snapshot: SnapshotResponse | null
  error: boolean
  locale: 'de' | 'en'
  live: boolean
  estimated: boolean
  shipName?: string
  lineName?: string
  ship?: CruiseShip | null
  stops?: PortStop[]
}

export function StatusStrip({
  snapshot,
  error,
  locale,
  live,
  estimated,
  shipName,
  lineName,
  ship = null,
  stops = [],
}: StatusStripProps) {
  const { t } = useTranslation()
  const scroller = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<(HTMLElement | null)[]>([])
  const [page, setPage] = useState(0)
  const [pageHeight, setPageHeight] = useState<number>()
  const [factsOpen, setFactsOpen] = useState(false)

  useLayoutEffect(() => {
    const el = pagesRef.current[page]
    if (!el) return
    const update = () => setPageHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [page, snapshot, locale, live, estimated, error, stops])

  function goTo(next: number) {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
    setPage(next)
  }

  function bindPage(index: number) {
    return (node: HTMLElement | null) => {
      pagesRef.current[index] = node
    }
  }

  if (!snapshot) {
    return (
      <Card className="pointer-events-auto w-full px-3 py-2.5 shadow-xl ring-0 sm:px-4 sm:py-3">
        <p className="text-base font-semibold text-muted-foreground">
          {error ? t('statusError') : t('statusLoading')}
        </p>
      </Card>
    )
  }

  const atPort = snapshot.nextPort.atPort
  const here = atPort ? snapshot.nextPort.berthName ?? snapshot.nextPort.name : snapshot.nextPort.name
  const nav = snapshot.motion?.nav ?? (atPort ? 'moored' : 'unknown')
  const navLabel =
    nav === 'moored'
      ? t('navMoored')
      : nav === 'anchored'
        ? t('navAnchored')
        : nav === 'aground'
          ? t('navAground')
          : nav === 'underway' || nav === 'restricted'
            ? t('navUnderway')
            : atPort
              ? t('navMoored')
              : null
  const fromName = !atPort ? snapshot.fromPort : null
  const pocName = here
  const departure = fromName && snapshot.departure?.planned ? formatArrivalParts(snapshot.departure.planned, locale) : null
  const arrival = formatArrivalParts(snapshot.nextPort.arriveAt, locale)
  const sourceLabel =
    snapshot.seenSource === 'ais'
      ? t('signalAis')
      : snapshot.seenSource === 'datadocked'
        ? t('sourceDd')
        : snapshot.dataDocked?.seenAt
          ? t('sourceDd')
          : null
  const sourceAria =
    snapshot.seenSource === 'ais'
      ? t('signalAis')
      : snapshot.seenSource === 'datadocked' || snapshot.dataDocked?.seenAt
        ? t('sourceDdFull')
        : null
  const seenIso = snapshot.seenAt ?? snapshot.dataDocked?.seenAt ?? null
  const seenTime = seenIso ? formatClock(new Date(seenIso), locale, DISPLAY_TZ) : null
  const liveMeta = [sourceAria, seenTime ? t('lastUpdateAria', { time: seenTime }) : null]
    .filter(Boolean)
    .join(', ')

  return (
    <Card className="pointer-events-auto w-full overflow-visible px-3 py-2 shadow-xl ring-0 sm:px-4 sm:py-3">
      <div
        ref={scroller}
        className="no-scrollbar flex items-start snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain transition-[height] duration-200 ease-out"
        style={pageHeight != null ? { height: pageHeight } : undefined}
        onScroll={(event) => {
          const el = event.currentTarget
          if (!el.clientWidth) return
          setPage(Math.round(el.scrollLeft / el.clientWidth))
        }}
      >
        <section ref={bindPage(0)} className="w-full shrink-0 snap-start basis-full" aria-label={t('facts')}>
          <div className="flex min-w-0 items-start gap-2 sm:gap-3">
            <div className="flex shrink-0 flex-col items-center" aria-label={liveMeta || undefined}>
              <Badge
                className={
                  live
                    ? 'gap-1.5 bg-accent px-2 py-0.5 text-xs text-primary-foreground sm:px-3 sm:py-1 sm:text-sm'
                    : estimated
                      ? 'gap-1.5 bg-primary/10 px-2 py-0.5 text-xs text-primary sm:px-3 sm:py-1 sm:text-sm'
                      : 'px-2 py-0.5 text-xs sm:px-3 sm:py-1 sm:text-sm'
                }
              >
                {live ? <span className="size-2 rounded-full bg-primary-foreground" aria-hidden /> : null}
                {live ? t('live') : snapshot.tracking === 'last-known' ? t('lastKnown') : t('approx')}
              </Badge>
              {sourceLabel || seenTime ? (
                <div className="mt-1.5 flex flex-col items-center gap-0.5 text-center">
                  {sourceLabel ? (
                    <p className="flex items-center gap-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                      <RadioTower className="h-3 w-3 text-sky-700" aria-hidden />
                      {sourceLabel}
                    </p>
                  ) : null}
                  {seenTime ? (
                    <p
                      className="tabular-nums text-[10px] leading-none text-muted-foreground"
                      title={seenIso ? formatSeen(seenIso, locale) : undefined}
                    >
                      {seenTime}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div
              className="min-w-0 flex-1"
              aria-label={fromName ? `${fromName} → ${pocName}` : pocName}
            >
              {fromName ? (
                <>
                  <p className="flex min-w-0 items-center gap-4 text-base font-semibold leading-tight sm:text-lg">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Ship className="h-4 w-4 shrink-0 fill-sky-100 text-sky-700 sm:h-5 sm:w-5" aria-hidden />
                      <span className="min-w-0 truncate">{fromName}</span>
                    </span>
                    {departure ? <ScheduleStamp label={t('departLabel')} parts={departure} /> : null}
                  </p>
                  <ArrowDown
                    className="my-0.5 ml-0.5 h-4 w-4 text-muted-foreground sm:ml-1 sm:h-5 sm:w-5"
                    aria-hidden
                  />
                </>
              ) : null}
              <p className="flex min-w-0 items-center gap-4 text-base font-semibold leading-tight sm:text-lg">
                <span className="flex min-w-0 items-center gap-1.5">
                  <MapPinned className="h-4 w-4 shrink-0 text-teal-600 sm:h-5 sm:w-5" aria-hidden />
                  <span className="min-w-0 truncate">{pocName}</span>
                </span>
                {arrival ? <ScheduleStamp label={t('arrival')} parts={arrival} /> : null}
              </p>
            </div>
            {snapshot.weather ? (
              <div
                className="flex shrink-0 flex-col items-center gap-0.5"
                aria-label={`${snapshot.weather.tempC}°, ${locale === 'de' ? snapshot.weather.labelDe : snapshot.weather.labelEn}`}
              >
                <WeatherGlyph code={snapshot.weather.weatherCode} className="h-5 w-5 sm:h-6 sm:w-6" />
                <p className="text-sm font-bold leading-none sm:text-base">{snapshot.weather.tempC}°</p>
              </div>
            ) : null}
          </div>
          {error ? (
            <div className="mt-1.5 min-w-0 text-xs leading-snug text-muted-foreground">
              <p role="status">{t('statusError')}</p>
            </div>
          ) : null}
        </section>
        <section
          ref={bindPage(1)}
          className="w-full shrink-0 snap-start basis-full pr-1"
          aria-label={t('today')}
        >
          <TodayPanel snapshot={snapshot} locale={locale} stops={stops} />
        </section>
      </div>
      <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
        <div className="flex min-w-0 justify-start">
          {navLabel ? (
            <Badge className={cn('w-auto max-w-full min-w-0 overflow-hidden px-2 py-0.5 text-[10px] sm:px-3 sm:py-1 sm:text-xs', navBadgeClass(nav))}>
              <span className="truncate">{navLabel}</span>
            </Badge>
          ) : null}
        </div>
        <div className="flex justify-center" role="tablist" aria-label={t('statusPages')}>
          {Array.from({ length: PAGE_COUNT }, (_, index) => (
            <Button
              key={index}
              variant="ghost"
              size="icon"
              role="tab"
              aria-label={index === 0 ? t('facts') : t('today')}
              aria-selected={page === index}
              onClick={() => goTo(index)}
            >
              <span className={cn('size-2 rounded-full', page === index ? 'bg-foreground' : 'bg-muted-foreground/40')} />
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          className="h-auto min-h-11 min-w-0 flex-col items-end justify-center gap-0 whitespace-normal px-1 py-1 text-right leading-tight"
          onClick={() => setFactsOpen(true)}
          aria-label={t('shipFacts')}
        >
          {shipName ? (
            <span className="block truncate text-[10px] font-semibold text-foreground sm:text-xs">{shipName}</span>
          ) : null}
          {lineName ? (
            <span className="block truncate text-[10px] text-muted-foreground sm:text-xs">{lineName}</span>
          ) : null}
        </Button>
      </div>
      <ShipFactsDialog open={factsOpen} onOpenChange={setFactsOpen} ship={ship} />
    </Card>
  )
}

export function TelemetryBar({ snapshot, locale }: { snapshot: SnapshotResponse | null; locale: 'de' | 'en' }) {
  const { t } = useTranslation()
  if (!snapshot) return null

  const atPort = snapshot.nextPort.atPort
  const nav = snapshot.motion?.nav ?? (atPort ? 'moored' : 'unknown')
  const speedKmh = formatSpeedKmh(snapshot.motion?.sogKn)
  const courseDeg = snapshot.motion?.cog ?? snapshot.motion?.heading ?? null
  const course =
    courseDeg != null && Number.isFinite(courseDeg)
      ? { deg: Math.round(courseDeg), dir: compassDir(courseDeg, locale) }
      : null

  const items: Metric[] = []
  if (speedKmh != null) {
    items.push({
      icon: <Gauge className="h-4 w-4 text-sky-600" aria-hidden />,
      label: t('speedKmh', { speed: formatSpeedLabel(speedKmh, locale) }),
    })
  } else if (nav === 'underway' || nav === 'restricted') {
    items.push({
      icon: <Gauge className="h-4 w-4 text-sky-600" aria-hidden />,
      label: t('speedUnknown'),
      muted: true,
    })
  }
  if (course) {
    items.push({
      icon: <Compass className="h-4 w-4 text-sky-600" aria-hidden />,
      label: t('course', { dir: course.dir, deg: course.deg }),
    })
  }
  if (snapshot.distanceKm != null && snapshot.distanceKm > 2) {
    items.push({
      icon: <MapPinned className="h-4 w-4 text-teal-600" aria-hidden />,
      label: t('distanceLeft', { km: snapshot.distanceKm }),
    })
  }
  if (!items.length) return null

  return (
    <Card className="pointer-events-auto w-full px-2 py-2 shadow-xl ring-0 sm:px-3 sm:py-2.5" aria-label={t('telemetry')}>
      <div className="flex divide-x divide-border/60">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-1 items-center justify-center gap-2 px-3 py-2.5">
            <span className="shrink-0">{item.icon}</span>
            <span
              className={cn(
                'truncate text-sm font-medium sm:text-base',
                item.muted ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

type Metric = {
  icon: React.ReactNode
  label: string
  muted?: boolean
}

function ScheduleStamp({
  label,
  parts,
}: {
  label: string
  parts: ReturnType<typeof formatArrivalParts>
}) {
  return (
    <span className="shrink-0 text-xs font-medium leading-tight text-muted-foreground sm:text-sm">
      {label} {parts.day}{' '}
      <span className="font-semibold tabular-nums text-foreground">
        {parts.time} {parts.offset}
      </span>
      {parts.homeTime ? (
        <>
          {' · '}
          <span className="font-semibold tabular-nums text-foreground">{parts.homeTime} UTC+2</span>
        </>
      ) : null}
    </span>
  )
}

function navBadgeClass(nav: string): string {
  if (nav === 'underway' || nav === 'restricted') {
    return 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-100'
  }
  if (nav === 'anchored') {
    return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
  }
  if (nav === 'aground') {
    return 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100'
  }
  return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-100'
}

function WeatherGlyph({ code, className = 'h-4 w-4' }: { code: WeatherInfo['weatherCode']; className?: string }) {
  if (code <= 1) return <Sun className={`${className} fill-amber-400 text-amber-500`} aria-hidden />
  if (code <= 3) return <Cloud className={`${className} fill-slate-300 text-slate-500`} aria-hidden />
  if (code <= 48) return <CloudFog className={`${className} text-slate-400`} aria-hidden />
  if (code <= 57) return <CloudDrizzle className={`${className} text-sky-500`} aria-hidden />
  if (code <= 67 || (code >= 80 && code <= 82)) {
    return <CloudRain className={`${className} fill-sky-100 text-sky-600`} aria-hidden />
  }
  if (code <= 77) return <CloudSnow className={`${className} text-sky-400`} aria-hidden />
  if (code >= 95) return <CloudLightning className={`${className} fill-slate-300 text-amber-500`} aria-hidden />
  return <Sun className={`${className} fill-amber-400 text-amber-500`} aria-hidden />
}

function formatSpeedKmh(sogKn: number | null | undefined): number | null {
  if (sogKn == null || sogKn < 0 || sogKn >= 102.2) return null
  const kn = sogKn > 80 ? sogKn / 10 : sogKn
  if (kn >= 80) return null
  const kmh = kn * 1.852
  if (kmh < 10) return Math.round(kmh * 10) / 10
  return Math.round(kmh)
}

function formatSpeedLabel(kmh: number, locale: 'de' | 'en'): string {
  return kmh.toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: kmh < 10 ? 1 : 0,
  })
}

function compassDir(degrees: number, locale: 'de' | 'en'): string {
  const dirs =
    locale === 'de' ? ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const sector = (((degrees % 360) + 360) % 360) / 45
  return dirs[Math.round(sector) % 8]
}
