import { useTranslation } from 'react-i18next'
import type { CruiseShip } from '@shared/types.ts'
import { factsForShip } from '@shared/ship-facts.ts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ShipFactsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  ship: CruiseShip | null
}

export function ShipFactsDialog({ open, onOpenChange, ship }: ShipFactsDialogProps) {
  const { t, i18n } = useTranslation()
  const facts = ship ? factsForShip(ship.id) : undefined
  const de = i18n.language.startsWith('de')
  const line = de ? ship?.lineDe || ship?.line : ship?.line

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ship?.name ?? t('ship')}</DialogTitle>
          <DialogDescription>{line || t('cruiseLine')}</DialogDescription>
        </DialogHeader>
        {ship ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            {facts ? (
              <>
                <Fact label={t('shipClass')} value={de ? facts.classNameDe : facts.className} />
                <Fact label={t('shipBuilt')} value={String(facts.built)} />
                <Fact label={t('shipLength')} value={`${facts.lengthM} m`} />
                {facts.beamM ? <Fact label={t('shipBeam')} value={`${facts.beamM} m`} /> : null}
                <Fact
                  label={t('shipPassengers')}
                  value={facts.passengers.toLocaleString(de ? 'de-DE' : 'en-GB')}
                />
                {facts.crew ? (
                  <Fact label={t('shipCrew')} value={facts.crew.toLocaleString(de ? 'de-DE' : 'en-GB')} />
                ) : null}
              </>
            ) : null}
            <Fact label="MMSI" value={ship.mmsi} />
            {ship.imo ? <Fact label="IMO" value={ship.imo} /> : null}
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-semibold leading-snug text-foreground">{value}</dd>
    </div>
  )
}
