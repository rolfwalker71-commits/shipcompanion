import { Anchor, ArrowRight, Clock, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Gauge, MapPinned, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SnapshotResponse, WeatherInfo } from '@shared/types.ts'
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
      ? `${t('navUnderway')}${fromBit} · ${t('arrival')} ${formatArrival(snapshot.nextPort.arriveAt, locale)}`
      : `${t('arrival')} ${formatArrival(snapshot.nextPort.arriveAt, locale)}`
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
      <p className="mt-2 text-sm leading-snug text-foreground">{snapshot.narrative}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {hasNext && atPort ? (
          <Badge className="gap-1.5 text-foreground">
            <ArrowRight className="h-3.5 w-3.5 text-sky-600" aria-hidden />
            {nextName} • {formatArrival(snapshot.nextPort.arriveAt, locale)}
          </Badge>
        ) : null}
        {showReported ? (
          <Badge className="gap-1.5 text-foreground">{t('reportedDest', { name: reported ?? '' })}</Badge>
        ) : null}
        {showAisEta && snapshot.voyage?.eta ? (
          <Badge className="gap-1.5 text-muted-foreground">
            {t('aisEta', { time: formatArrival(snapshot.voyage.eta, locale) })}
          </Badge>
        ) : null}
        {speedKmh != null ? (
          <Badge className="gap-1.5 text-foreground">
            <Gauge className="h-3.5 w-3.5 text-sky-600" aria-hidden />
            {t('speedKmh', { speed: speedKmh })}
          </Badge>
        ) : null}
        {snapshot.distanceKm != null && snapshot.distanceKm > 2 ? (
          <Badge className="gap-1.5 text-foreground">
            <MapPinned className="h-3.5 w-3.5 text-teal-600" aria-hidden />
            {t('distanceLeft', { km: snapshot.distanceKm })}
          </Badge>
        ) : null}
        {atPort && snapshot.departure ? (
          <Badge className="gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            {t('departPlanned')} {formatArrival(snapshot.departure.planned, locale)}
          </Badge>
        ) : null}
        {snapshot.departure?.actual ? (
          <Badge className="gap-1.5 text-foreground">
            <Ship className="h-3.5 w-3.5 fill-emerald-100 text-emerald-600" aria-hidden />
            {atPort
              ? `${t('departActual')} ${formatArrival(snapshot.departure.actual, locale)}`
              : `${t('leftPort', { name: snapshot.departure.portName })} ${formatArrival(snapshot.departure.actual, locale)}`}
          </Badge>
        ) : snapshot.departure && atPort ? (
          <Badge className="gap-1.5 text-muted-foreground">
            <Ship className="h-3.5 w-3.5 fill-orange-100 text-orange-500" aria-hidden />
            {t('departActual')} {t('departPending')}
          </Badge>
        ) : snapshot.departure && !atPort ? (
          <Badge className="gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            {t('leftPort', { name: snapshot.departure.portName })} {formatArrival(snapshot.departure.planned, locale)}
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
          <Badge
            className="shrink-0 gap-1 text-foreground"
            aria-label={`${snapshot.weather.tempC}°, ${locale === 'de' ? snapshot.weather.labelDe : snapshot.weather.labelEn}`}
          >
            <WeatherGlyph code={snapshot.weather.weatherCode} />
            {snapshot.weather.tempC}°
          </Badge>
        ) : null}
      </div>
    </Card>
  )
}

function WeatherGlyph({ code }: { code: WeatherInfo['weatherCode'] }) {
  const className = 'h-4 w-4'
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
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatSeen(iso: string, locale: 'de' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
