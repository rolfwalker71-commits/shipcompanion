import { useRef, useState } from 'react'
import { Anchor, ArrowRight, Clock, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Gauge, MapPinned, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SnapshotResponse, WeatherInfo } from '@shared/types.ts'
import { resolveAisDestination } from '@shared/ais.ts'
import { formatSeen, formatWhen } from '@shared/time.ts'
import { useCompactUi } from '@/lib/compact'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type StatusStripProps = {
  snapshot: SnapshotResponse | null
  error: boolean
  locale: 'de' | 'en'
  live: boolean
  estimated: boolean
}

export function StatusStrip({ snapshot, error, locale, live, estimated }: StatusStripProps) {
  const { t } = useTranslation()
  const compact = useCompactUi()
  const scroller = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  const when = (iso: string) => formatWhen(iso, locale, !compact)

  function goTo(next: number) {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
    setPage(next)
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
  const stopped = nav === 'moored' || nav === 'anchored' || nav === 'aground'
  const departPast =
    atPort && snapshot.nextPort.departAt
      ? Date.now() > new Date(snapshot.nextPort.departAt).getTime()
      : false
  const fromBit = !atPort && snapshot.fromPort ? ` ${t('fromPort', { name: snapshot.fromPort })}` : ''
  const speedKmh = formatSpeedKmh(snapshot.motion?.sogKn)
  const subtitle = atPort
    ? nav === 'anchored'
      ? t('navAnchored')
      : departPast
        ? t('stillBerth')
        : t('navMoored')
    : nav === 'underway' || nav === 'restricted'
      ? `${t('navUnderway')}${fromBit} · ${t('arrival')} ${when(snapshot.nextPort.arriveAt)}`
      : `${t('arrival')} ${when(snapshot.nextPort.arriveAt)}`
  const reported = snapshot.voyage?.destination?.trim() || null
  const reportedPlace = reported ? resolveAisDestination(reported, [], locale) ?? reported : null
  const showReported =
    reportedPlace != null && !samePlace(reportedPlace, here) && !samePlace(reportedPlace, nextName)
  const showAisEta =
    !atPort &&
    snapshot.voyage?.eta &&
    Math.abs(new Date(snapshot.voyage.eta).getTime() - new Date(snapshot.nextPort.arriveAt).getTime()) >
      90 * 60 * 1000
  const courseDeg =
    snapshot.motion?.cog ?? snapshot.motion?.heading ?? null
  const course =
    courseDeg != null && Number.isFinite(courseDeg)
      ? { deg: Math.round(courseDeg), dir: compassDir(courseDeg, locale) }
      : null

  return (
    <Card className="pointer-events-auto w-full overflow-visible px-3 py-2.5 shadow-xl ring-0 sm:px-4 sm:py-3">
      <div
        ref={scroller}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        onScroll={(event) => {
          const el = event.currentTarget
          if (!el.clientWidth) return
          setPage(Math.round(el.scrollLeft / el.clientWidth))
        }}
      >
        <section className="w-full shrink-0 snap-start basis-full" aria-label={t('facts')}>
          <div className="flex items-center gap-2 sm:gap-3">
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
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {stopped ? (
                  <Anchor className="h-4 w-4 shrink-0 fill-teal-100 text-teal-600 sm:h-5 sm:w-5" aria-hidden />
                ) : (
                  <Ship className="h-4 w-4 shrink-0 fill-sky-100 text-sky-700 sm:h-5 sm:w-5" aria-hidden />
                )}
                <p className="min-w-0 truncate text-base font-semibold leading-tight sm:text-lg">{here}</p>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground sm:text-sm">{subtitle}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {speedKmh != null ? (
              <InfoTile
                icon={<Gauge className="h-3.5 w-3.5 text-sky-600" aria-hidden />}
                label={t('speedKmh', { speed: formatSpeedLabel(speedKmh, locale) })}
              />
            ) : nav === 'underway' || nav === 'restricted' ? (
              <InfoTile
                icon={<Gauge className="h-3.5 w-3.5 text-sky-600" aria-hidden />}
                label={t('speedUnknown')}
                muted
              />
            ) : null}
            {course ? (
              <InfoTile
                icon={<Compass className="h-3.5 w-3.5 text-sky-600" aria-hidden />}
                label={t('course', { dir: course.dir, deg: course.deg })}
              />
            ) : null}
            {snapshot.distanceKm != null && snapshot.distanceKm > 2 ? (
              <InfoTile
                icon={<MapPinned className="h-3.5 w-3.5 text-teal-600" aria-hidden />}
                label={t('distanceLeft', { km: snapshot.distanceKm })}
              />
            ) : null}
            {hasNext && atPort ? (
              <InfoTile
                icon={<ArrowRight className="h-3.5 w-3.5 text-sky-600" aria-hidden />}
                label={`${nextName} • ${when(snapshot.nextPort.arriveAt)}`}
              />
            ) : null}
            {showReported ? (
              <InfoTile label={t('reportedDest', { name: reportedPlace ?? '' })} />
            ) : null}
            {showAisEta && snapshot.voyage?.eta ? (
              <InfoTile label={t('aisEta', { time: when(snapshot.voyage.eta) })} muted />
            ) : null}
            {snapshot.departure ? (
              <InfoTile
                icon={<Clock className="h-3.5 w-3.5 text-amber-500" aria-hidden />}
                label={`${t('departPlanned')} ${when(snapshot.departure.planned)}`}
                muted
              />
            ) : null}
            {snapshot.departure?.actual ? (
              <InfoTile
                icon={<Ship className="h-3.5 w-3.5 fill-emerald-100 text-emerald-600" aria-hidden />}
                label={`${t('departActual')} ${when(snapshot.departure.actual)}`}
              />
            ) : snapshot.departure ? (
              <InfoTile
                icon={<Ship className="h-3.5 w-3.5 fill-orange-100 text-orange-500" aria-hidden />}
                label={`${t('departActual')} ${atPort ? t('departPending') : t('departUnknown')}`}
                muted
              />
            ) : null}
            {snapshot.dataDocked ? (
              <InfoTile label={t('dockedRemaining', { count: snapshot.dataDocked.remaining })} muted />
            ) : null}
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="min-w-0 text-xs leading-snug text-muted-foreground">
              {error ? <p role="status">{t('statusError')}</p> : null}
              {snapshot.seenAt || snapshot.dataDocked?.seenAt ? (
                <>
                  {snapshot.seenAt ? (
                    <p>{t('lastSeenShort', { time: formatSeen(snapshot.seenAt, locale, !compact) })}</p>
                  ) : null}
                  {snapshot.dataDocked?.seenAt ? (
                    <p>
                      {t(snapshot.dataDocked.source === 'SAT' ? 'lastSeenDockedSat' : 'lastSeenDocked', {
                        time: formatSeen(snapshot.dataDocked.seenAt, locale, !compact),
                      })}
                    </p>
                  ) : snapshot.dataDocked ? (
                    <p>{t('lastSeenDockedNone')}</p>
                  ) : null}
                  {snapshot.tracking === 'estimated' ? <p>{t('approxEstimate')}</p> : null}
                </>
              ) : snapshot.tracking === 'no-key' ? (
                <p>{t('approxNoKey')}</p>
              ) : snapshot.tracking === 'ais-error' ? (
                <p>{t('approxAisError')}</p>
              ) : snapshot.tracking === 'estimated' ? (
                <p>{t('approxEstimate')}</p>
              ) : null}
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
        </section>
        <section className="flex w-full shrink-0 snap-start basis-full flex-col justify-center pr-1" aria-label={t('story')}>
          <p className="text-base leading-relaxed sm:text-lg">{snapshot.narrative || t('narrativeEmpty')}</p>
        </section>
      </div>
      <div className="flex justify-center" role="tablist" aria-label={t('statusPages')}>
        <Button
          variant="ghost"
          size="icon"
          role="tab"
          aria-label={t('facts')}
          aria-selected={page === 0}
          onClick={() => goTo(0)}
        >
          <span className={cn('size-2 rounded-full', page === 0 ? 'bg-foreground' : 'bg-muted-foreground/40')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          role="tab"
          aria-label={t('story')}
          aria-selected={page === 1}
          onClick={() => goTo(1)}
        >
          <span className={cn('size-2 rounded-full', page === 1 ? 'bg-foreground' : 'bg-muted-foreground/40')} />
        </Button>
      </div>
    </Card>
  )
}

function InfoTile({
  icon,
  label,
  muted = false,
}: {
  icon?: React.ReactNode
  label: string
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-2xl bg-muted/70 px-3 py-2 text-sm leading-snug',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 break-words">{label}</span>
    </div>
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
