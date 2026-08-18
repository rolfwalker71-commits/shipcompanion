import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Clock, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Gauge, MapPinned, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SnapshotResponse, WeatherInfo } from '@shared/types.ts'
import { resolveAisDestination } from '@shared/ais.ts'
import { formatArrivalParts, formatSeen, formatWhen } from '@shared/time.ts'
import { useCompactUi } from '@/lib/compact'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const PAGE_COUNT = 3

type StatusStripProps = {
  snapshot: SnapshotResponse | null
  error: boolean
  locale: 'de' | 'en'
  live: boolean
  estimated: boolean
  shipName?: string
  lineName?: string
}

export function StatusStrip({ snapshot, error, locale, live, estimated, shipName, lineName }: StatusStripProps) {
  const { t } = useTranslation()
  const compact = useCompactUi()
  const scroller = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<(HTMLElement | null)[]>([])
  const [page, setPage] = useState(0)
  const [pageHeight, setPageHeight] = useState<number>()
  const when = (iso: string) => formatWhen(iso, locale, !compact)

  useLayoutEffect(() => {
    const el = pagesRef.current[page]
    if (!el) return
    const update = () => setPageHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [page, snapshot, compact, locale, live, estimated, error])

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
  const nextName = snapshot.nextPort.name
  const hasNext = !atPort || (snapshot.nextPort.berthName != null && snapshot.nextPort.berthName !== nextName)
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
  const arrivalIso = !atPort && snapshot.voyage?.eta ? snapshot.voyage.eta : snapshot.nextPort.arriveAt
  const arrival = formatArrivalParts(arrivalIso, locale)
  const reported = snapshot.voyage?.destination?.trim() || null
  const reportedPlace = reported ? resolveAisDestination(reported, [], locale) ?? reported : null
  const showReported =
    reportedPlace != null && !samePlace(reportedPlace, here) && !samePlace(reportedPlace, nextName)
  const aisEta = snapshot.voyage?.eta ?? null
  const showAisEta =
    !atPort &&
    aisEta != null &&
    Math.abs(new Date(aisEta).getTime() - new Date(snapshot.nextPort.arriveAt).getTime()) > 90 * 60 * 1000

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
            <Badge
              className={
                live
                  ? 'shrink-0 gap-1.5 bg-accent px-2 py-0.5 text-xs text-primary-foreground sm:px-3 sm:py-1 sm:text-sm'
                  : estimated
                    ? 'shrink-0 gap-1.5 bg-primary/10 px-2 py-0.5 text-xs text-primary sm:px-3 sm:py-1 sm:text-sm'
                    : 'shrink-0 px-2 py-0.5 text-xs sm:px-3 sm:py-1 sm:text-sm'
              }
            >
              {live ? <span className="size-2 rounded-full bg-primary-foreground" aria-hidden /> : null}
              {live ? t('live') : snapshot.tracking === 'last-known' ? t('lastKnown') : t('approx')}
            </Badge>
            <div
              className="min-w-0 flex-1"
              aria-label={fromName ? `${fromName} → ${pocName}` : pocName}
            >
              {fromName ? (
                <>
                  <p className="flex min-w-0 items-center gap-1.5 text-base font-semibold leading-tight sm:text-lg">
                    <Ship className="h-4 w-4 shrink-0 fill-sky-100 text-sky-700 sm:h-5 sm:w-5" aria-hidden />
                    <span className="min-w-0 truncate">{fromName}</span>
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
                {arrival ? (
                  <span className="shrink-0 text-xs font-medium leading-tight text-muted-foreground sm:text-sm">
                    {t('arrival')} {arrival.day}{' '}
                    <span className="font-semibold tabular-nums text-foreground">
                      {arrival.time} {arrival.offset}
                    </span>
                    {arrival.homeTime ? (
                      <>
                        {' · '}
                        <span className="font-semibold tabular-nums text-foreground">{arrival.homeTime} UTC+2</span>
                      </>
                    ) : null}
                  </span>
                ) : null}
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
          className="flex w-full shrink-0 snap-start basis-full flex-col justify-center pr-1"
          aria-label={t('story')}
        >
          <p className="text-base leading-relaxed sm:text-lg">{snapshot.narrative || t('narrativeEmpty')}</p>
        </section>
        <section ref={bindPage(2)} className="w-full shrink-0 snap-start basis-full pr-1" aria-label={t('details')}>
          <div className="flex flex-col gap-1.5">
            {hasNext && atPort ? (
              <DetailLine icon={<ArrowRight className="h-3.5 w-3.5 text-sky-600" aria-hidden />}>
                {nextName} • {when(snapshot.nextPort.arriveAt)}
              </DetailLine>
            ) : null}
            {showReported ? (
              <DetailLine>{t('reportedDest', { name: reportedPlace ?? '' })}</DetailLine>
            ) : null}
            {showAisEta && aisEta ? (
              <DetailLine muted>{t('aisEta', { time: when(aisEta) })}</DetailLine>
            ) : null}
            {snapshot.departure ? (
              <DetailLine icon={<Clock className="h-3.5 w-3.5 text-amber-500" aria-hidden />} muted>
                {`${t('departPlanned')} ${when(snapshot.departure.planned)}`}
              </DetailLine>
            ) : null}
            {snapshot.departure?.actual ? (
              <DetailLine icon={<Ship className="h-3.5 w-3.5 fill-emerald-100 text-emerald-600" aria-hidden />}>
                {`${t('departActual')} ${when(snapshot.departure.actual)}`}
              </DetailLine>
            ) : snapshot.departure ? (
              <DetailLine icon={<Ship className="h-3.5 w-3.5 fill-orange-100 text-orange-500" aria-hidden />} muted>
                {`${t('departActual')} ${atPort ? t('departPending') : t('departUnknown')}`}
              </DetailLine>
            ) : null}
            {snapshot.seenAt ? (
              <DetailLine>{t('lastSeenShort', { time: formatSeen(snapshot.seenAt, locale, !compact) })}</DetailLine>
            ) : null}
            {snapshot.dataDocked?.seenAt ? (
              <DetailLine>
                {t(snapshot.dataDocked.source === 'SAT' ? 'lastSeenDockedSat' : 'lastSeenDocked', {
                  time: formatSeen(snapshot.dataDocked.seenAt, locale, !compact),
                })}
              </DetailLine>
            ) : snapshot.dataDocked?.lastError ? (
              <DetailLine muted>{t('lastSeenDockedError', { error: snapshot.dataDocked.lastError })}</DetailLine>
            ) : snapshot.dataDocked ? (
              <DetailLine muted>{t('lastSeenDockedNone')}</DetailLine>
            ) : null}
            {snapshot.dataDocked ? (
              <DetailLine muted>{t('dockedRemaining', { count: snapshot.dataDocked.remaining })}</DetailLine>
            ) : null}
            {snapshot.tracking === 'no-key' ? (
              <DetailLine muted>{t('approxNoKey')}</DetailLine>
            ) : snapshot.tracking === 'ais-error' ? (
              <DetailLine muted>{t('approxAisError')}</DetailLine>
            ) : snapshot.tracking === 'estimated' ? (
              <DetailLine muted>{t('approxEstimate')}</DetailLine>
            ) : null}
            {!hasExtraDetails(snapshot, hasNext && atPort, showReported, showAisEta) ? (
              <p className="text-sm text-muted-foreground">{t('detailsEmpty')}</p>
            ) : null}
          </div>
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
              aria-label={index === 0 ? t('facts') : index === 1 ? t('story') : t('details')}
              aria-selected={page === index}
              onClick={() => goTo(index)}
            >
              <span className={cn('size-2 rounded-full', page === index ? 'bg-foreground' : 'bg-muted-foreground/40')} />
            </Button>
          ))}
        </div>
        <div
          className="min-w-0 text-right leading-tight"
          title={[shipName, lineName].filter(Boolean).join(' · ')}
          aria-label={[shipName, lineName].filter(Boolean).join(', ')}
        >
          {shipName ? (
            <p className="truncate text-[10px] font-semibold text-foreground sm:text-xs">{shipName}</p>
          ) : null}
          {lineName ? (
            <p className="truncate text-[10px] text-muted-foreground sm:text-xs">{lineName}</p>
          ) : null}
        </div>
      </div>
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

function DetailLine({
  icon,
  children,
  muted = false,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <p className={cn('flex items-start gap-2 text-sm leading-snug', muted ? 'text-muted-foreground' : 'text-foreground')}>
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

function hasExtraDetails(
  snapshot: SnapshotResponse,
  nextAtPort: boolean,
  showReported: boolean,
  showAisEta: boolean,
): boolean {
  return Boolean(
    nextAtPort ||
      showReported ||
      showAisEta ||
      snapshot.departure ||
      snapshot.seenAt ||
      snapshot.dataDocked ||
      snapshot.tracking === 'no-key' ||
      snapshot.tracking === 'ais-error' ||
      snapshot.tracking === 'estimated',
  )
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

function samePlace(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  if (!left || !right) return false
  if (left === right || left.includes(right) || right.includes(left)) return true
  const tokens = (value: string) => value.split(/[^a-z0-9äöüß]+/i).filter((part) => part.length >= 3)
  const aTok = tokens(left)
  const bTok = tokens(right)
  return aTok.some((part) => bTok.some((other) => other.includes(part) || part.includes(other)))
}
