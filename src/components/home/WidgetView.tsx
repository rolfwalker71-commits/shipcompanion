import { ArrowRight, Gauge, Map as MapIcon, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '@shared/types.ts'
import { DISPLAY_TZ, formatClock, formatWhen } from '@shared/time.ts'
import { useCompactUi } from '@/lib/compact'
import { useSnapshot } from '@/lib/use-snapshot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DualClock } from './TodayPanel'

type WidgetViewProps = {
  trip: Trip
}

export function WidgetView({ trip }: WidgetViewProps) {
  const { t } = useTranslation()
  const compact = useCompactUi()
  const { snapshot, error, locale, live, estimated } = useSnapshot(trip)
  const speedKmh = formatSpeedKmh(snapshot?.motion?.sogKn)
  const offItinerary = snapshot?.offItinerary ?? false
  const nextName = snapshot?.nextPort.name
  const atPort = offItinerary ? false : (snapshot?.nextPort.atPort ?? false)
  const mooredAt = atPort
    ? snapshot?.nextPort.berthName ?? snapshot?.departure?.portName ?? nextName
    : null
  const showNextLeg = Boolean(!offItinerary && mooredAt && nextName && nextName !== mooredAt)
  const headline = offItinerary ? t('offItinerary') : (mooredAt ?? nextName)

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-muted px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Card className="flex w-full max-w-md flex-col gap-4 p-5 shadow-xl ring-0 sm:p-6">
        {!snapshot ? (
          <p className="text-base font-semibold text-muted-foreground">
            {error ? t('statusError') : t('statusLoading')}
          </p>
        ) : (
          <>
            <div className="min-w-0">
              <Badge
                className={
                  live
                    ? 'mb-1.5 w-max bg-accent px-2 py-1 text-xs text-primary-foreground'
                    : estimated
                      ? 'mb-1.5 w-max bg-primary/10 px-2 py-1 text-xs text-primary'
                      : 'mb-1.5 w-max px-2 py-1 text-xs'
                }
              >
                {live ? t('live') : snapshot.tracking === 'last-known' ? t('lastKnown') : t('approx')}
              </Badge>
              <p className="break-words text-lg font-semibold leading-snug">{headline}</p>
              {showNextLeg ? (
                <div className="mt-1 space-y-0.5 text-sm leading-snug text-muted-foreground">
                  <p>{t('continuesTo', { name: nextName })}</p>
                  {snapshot.departure?.planned || snapshot.nextPort.arriveAt ? (
                    <p>
                      {snapshot.departure?.planned ? (
                        <>{t('departLabel')} {formatWhen(snapshot.departure.planned, locale, !compact)}</>
                      ) : null}
                      {snapshot.departure?.planned && snapshot.nextPort.arriveAt ? ' · ' : null}
                      {snapshot.nextPort.arriveAt ? (
                        <>{t('arrival')} {formatWhen(snapshot.nextPort.arriveAt, locale, !compact)}</>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <p className="text-base leading-relaxed">{snapshot.narrative || t('narrativeEmpty')}</p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <DualClock locale={locale} shipTz={snapshot.shipTz} className="text-sm" />
              {snapshot.sun ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatClock(new Date(snapshot.sun.sunrise), locale, snapshot.shipTz || DISPLAY_TZ)}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Moon className="h-3.5 w-3.5 text-indigo-400" aria-hidden />
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatClock(new Date(snapshot.sun.sunset), locale, snapshot.shipTz || DISPLAY_TZ)}
                    </span>
                  </span>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {speedKmh != null ? (
                <Badge className="gap-1.5 px-2.5 py-1 text-sm">
                  <Gauge className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                  {t('speedKmh', { speed: formatSpeedLabel(speedKmh, locale) })}
                </Badge>
              ) : null}
              {nextName && !showNextLeg ? (
                <Badge className="gap-1.5 px-2.5 py-1 text-sm">
                  <ArrowRight className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                  {`${t('arrival')} ${formatWhen(snapshot.nextPort.arriveAt, locale, !compact)}`}
                </Badge>
              ) : null}
            </div>
          </>
        )}
        <Button variant="secondary" className="mt-auto" onClick={() => window.location.assign('/')}>
          <MapIcon className="h-4 w-4" />
          {t('openMap')}
        </Button>
      </Card>
    </div>
  )
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
