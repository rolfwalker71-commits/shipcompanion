import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Anchor, Radio, RadioTower, Satellite, Ship, Smartphone, Waypoints } from 'lucide-react'
import type { TimelineEvent, TimelineKind } from '@shared/types.ts'
import { formatWhen } from '@shared/time.ts'
import { useCompactUi } from '@/lib/compact'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type TimelineDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mmsi?: string
}

export function TimelineDialog({ open, onOpenChange, mmsi }: TimelineDialogProps) {
  const { t, i18n } = useTranslation()
  const compact = useCompactUi()
  const locale = i18n.language.startsWith('de') ? 'de' : 'en'
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetch(mmsi ? `/api/timeline?mmsi=${encodeURIComponent(mmsi)}` : '/api/timeline', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data: { events?: TimelineEvent[] }) => {
        if (!cancelled) setEvents(data.events ?? [])
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
    return () => {
      cancelled = true
    }
  }, [open, mmsi])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('timeline')}</DialogTitle>
          <DialogDescription>{t('timelineHint')}</DialogDescription>
        </DialogHeader>
        <ol className="mt-4 flex flex-col gap-4">
          {events == null ? (
            <li className="text-sm text-muted-foreground">{t('statusLoading')}</li>
          ) : events.length === 0 ? (
            <li className="text-sm leading-relaxed text-muted-foreground">{t('timelineEmpty')}</li>
          ) : (
            events.map((event) => {
              const title = locale === 'de' ? event.titleDe : event.titleEn
              const detail = locale === 'de' ? event.detailDe : event.detailEn
              const Icon = kindIcon(event.kind)
              return (
                <li key={event.id} className="flex gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-5 w-5 text-sky-700" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug">{title}</p>
                    {detail ? (
                      <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{detail}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatWhen(event.at, locale, !compact)}
                    </p>
                  </div>
                </li>
              )
            })
          )}
        </ol>
      </DialogContent>
    </Dialog>
  )
}

function kindIcon(kind: TimelineKind) {
  if (kind === 'arrived') return Anchor
  if (kind === 'departed') return Ship
  if (kind === 'approaching') return Waypoints
  if (kind === 'ais-gap') return Radio
  if (kind === 'docked-back') return Satellite
  if (kind === 'manual-position') return Smartphone
  return RadioTower
}
