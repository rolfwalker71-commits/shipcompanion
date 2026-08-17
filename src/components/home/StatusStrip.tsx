import { Anchor, ArrowRight, Clock, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Gauge, MapPinned, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SnapshotResponse, WeatherInfo } from '@shared/types.ts'
import { formatSeen, formatWhen } from '@shared/time.ts'
import { Badge } from '@/components/ui/badge'
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

  if (!snapshot) {
    return (
      <Card className="pointer-events-auto w-full max-w-2xl px-4 py-3 shadow-xl ring-0">
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
  const subtitle = atPort
    ? nav === 'anchored'
      ? t('navAnchored')
      : departPast
        ? t('stillBerth')
        : t('navMoored')
    : nav === 'underway' || nav === 'restricted'
      ? `${t('navUnderway')}${fromBit} · ${t('arrival')} ${formatWhen(snapshot.nextPort.arriveAt, locale, true)}`
      : `${t('arrival')} ${formatWhen(snapshot.nextPort.arriveAt, locale, true)}`
  const reported = snapshot.voyage?.destination?.trim() || null
  const showReported =
    reported != null &&
    reported.toLowerCase() !== here.toLowerCase() &&
    reported.toLowerCase() !== nextName.toLowerCase()
  const showAisEta =
    !atPort &&
    snapshot.voyage?.eta &&
    Math.abs(new Date(snapshot.voyage.eta).getTime() - new Date(snapshot.nextPort.arriveAt).getTime()) >
      90 * 60 * 1000
  const speedKmh =
    snapshot.motion?.sogKn != null && snapshot.motion.sogKn >= 0.5
      ? Math.round(snapshot.motion.sogKn * 1.852)
      : null
  const courseDeg =
    snapshot.motion?.cog ?? snapshot.motion?.heading ?? null
  const course =
    courseDeg != null && (speedKmh != null || nav === 'underway' || nav === 'restricted')
      ? { deg: Math.round(courseDeg), dir: compassDir(courseDeg, locale) }
      : null
  const zone = snapshot.zone?.trim() || null

  return (
    <Card className="pointer-events-auto w-full max-w-2xl px-4 py-3 shadow-xl ring-0">
      <div className="flex items-center gap-3">
        <Badge
          className={
            live
              ? 'shrink-0 gap-1.5 bg-accent text-primary-foreground'
              : estimated
                ? 'shrink-0 gap-1.5 bg-primary/10 text-primary'
                : 'shrink-0'
          }
        >
          {live ? <span className="size-2 rounded-full bg-primary-foreground" aria-hidden /> : null}
          {live ? t('live') : t('approx')}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {stopped ? (
              <Anchor className="h-5 w-5 shrink-0 fill-teal-100 text-teal-600" aria-hidden />
            ) : (
              <Ship className="h-5 w-5 shrink-0 fill-sky-100 text-sky-700" aria-hidden />
            )}
            <p className="truncate text-lg font-semibold leading-tight">{here}</p>
          </div>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {hasNext && atPort ? (
          <Badge className="gap-1.5 text-foreground">
            <ArrowRight className="h-3.5 w-3.5 text-sky-600" aria-hidden />
            {nextName} • {formatWhen(snapshot.nextPort.arriveAt, locale, true)}
          </Badge>
        ) : null}
        {showReported ? (
          <Badge className="gap-1.5 text-foreground">{t('reportedDest', { name: reported ?? '' })}</Badge>
        ) : null}
        {showAisEta && snapshot.voyage?.eta ? (
          <Badge className="gap-1.5 text-muted-foreground">
            {t('aisEta', { time: formatWhen(snapshot.voyage.eta, locale, true) })}
          </Badge>
        ) : null}
        {speedKmh != null ? (
          <Badge className="gap-1.5 text-foreground">
            <Gauge className="h-3.5 w-3.5 text-sky-600" aria-hidden />
            {t('speedKmh', { speed: speedKmh })}
          </Badge>
        ) : null}
        {course ? (
          <Badge className="gap-1.5 text-foreground">
            <Compass className="h-3.5 w-3.5 text-sky-600" aria-hidden />
            {t('course', { dir: course.dir, deg: course.deg })}
          </Badge>
        ) : null}
        {zone ? (
          <Badge className="gap-1.5 text-foreground">{t('seaZone', { name: zone })}</Badge>
        ) : null}
        {snapshot.distanceKm != null && snapshot.distanceKm > 2 ? (
          <Badge className="gap-1.5 text-foreground">
            <MapPinned className="h-3.5 w-3.5 text-teal-600" aria-hidden />
            {t('distanceLeft', { km: snapshot.distanceKm })}
          </Badge>
        ) : null}
        {snapshot.departure ? (
          <Badge className="gap-1.5 whitespace-normal text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            {t('departPlanned')} {formatWhen(snapshot.departure.planned, locale, true)}
          </Badge>
        ) : null}
        {snapshot.departure?.actual ? (
          <Badge className="gap-1.5 whitespace-normal text-foreground">
            <Ship className="h-3.5 w-3.5 shrink-0 fill-emerald-100 text-emerald-600" aria-hidden />
            {t('departActual')} {formatWhen(snapshot.departure.actual, locale, true)}
          </Badge>
        ) : snapshot.departure ? (
          <Badge className="gap-1.5 text-muted-foreground">
            <Ship className="h-3.5 w-3.5 shrink-0 fill-orange-100 text-orange-500" aria-hidden />
            {t('departActual')} {atPort ? t('departPending') : t('departUnknown')}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        {error ? (
          <p className="min-w-0 text-xs text-muted-foreground" role="status">
            {t('statusError')}
          </p>
        ) : snapshot.seenAt ? (
          <p className="min-w-0 text-xs text-muted-foreground">
            {t('lastSeenShort', { time: formatSeen(snapshot.seenAt, locale) })}
          </p>
        ) : snapshot.tracking === 'no-key' ? (
          <p className="min-w-0 text-xs text-muted-foreground">{t('approxNoKey')}</p>
        ) : snapshot.tracking === 'ais-error' ? (
          <p className="min-w-0 text-xs text-muted-foreground">{t('approxAisError')}</p>
        ) : (
          <span />
        )}
        {snapshot.weather ? (
          <div
            className="flex shrink-0 flex-col items-center gap-0.5"
            aria-label={`${snapshot.weather.tempC}°, ${locale === 'de' ? snapshot.weather.labelDe : snapshot.weather.labelEn}`}
          >
            <WeatherGlyph code={snapshot.weather.weatherCode} className="h-6 w-6" />
            <p className="text-base font-bold leading-none">{snapshot.weather.tempC}°</p>
          </div>
        ) : null}
      </div>
    </Card>
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

function compassDir(degrees: number, locale: 'de' | 'en'): string {
  const dirs =
    locale === 'de' ? ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const sector = (((degrees % 360) + 360) % 360) / 45
  return dirs[Math.round(sector) % 8]
}
