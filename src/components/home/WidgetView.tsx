import { ArrowRight, Gauge, Map as MapIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '@shared/types.ts'
import { formatWhen } from '@shared/time.ts'
import { useCompactUi } from '@/lib/compact'
import { useSnapshot } from '@/lib/use-snapshot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type WidgetViewProps = {
  trip: Trip
}

export function WidgetView({ trip }: WidgetViewProps) {
  const { t } = useTranslation()
  const compact = useCompactUi()
  const { snapshot, error, locale, live, estimated } = useSnapshot(trip)
  const speedKmh = formatSpeedKmh(snapshot?.motion?.sogKn)
  const nextName = snapshot?.nextPort.name
  const atPort = snapshot?.nextPort.atPort ?? false
  const here = atPort ? snapshot?.nextPort.berthName ?? nextName : nextName

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-muted px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Card className="flex w-full max-w-md flex-col gap-4 p-5 shadow-xl ring-0 sm:p-6">
        {!snapshot ? (
          <p className="text-base font-semibold text-muted-foreground">
            {error ? t('statusError') : t('statusLoading')}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge
                className={
                  live
                    ? 'shrink-0 bg-accent px-2 py-0.5 text-xs text-primary-foreground'
                    : estimated
                      ? 'shrink-0 bg-primary/10 px-2 py-0.5 text-xs text-primary'
                      : 'shrink-0 px-2 py-0.5 text-xs'
                }
              >
                {live ? t('live') : snapshot.tracking === 'last-known' ? t('lastKnown') : t('approx')}
              </Badge>
              <p className="min-w-0 truncate text-lg font-semibold">{here}</p>
            </div>
            <p className="text-base leading-relaxed">{snapshot.narrative || t('narrativeEmpty')}</p>
            <div className="flex flex-wrap gap-2">
              {speedKmh != null ? (
                <Badge className="gap-1.5 px-2.5 py-1 text-sm">
                  <Gauge className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                  {t('speedKmh', { speed: formatSpeedLabel(speedKmh, locale) })}
                </Badge>
              ) : null}
              {nextName ? (
                <Badge className="gap-1.5 px-2.5 py-1 text-sm">
                  <ArrowRight className="h-3.5 w-3.5 text-sky-600" aria-hidden />
                  {atPort
                    ? `${nextName} • ${formatWhen(snapshot.nextPort.arriveAt, locale, !compact)}`
                    : `${t('arrival')} ${formatWhen(snapshot.nextPort.arriveAt, locale, !compact)}`}
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
