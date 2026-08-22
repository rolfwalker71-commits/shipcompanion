import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CUSTOM_SHIP_ID, cruiseLines, shipById, shipsForLine, tripShip } from '@shared/ships.ts'
import { itineraryPresets, presetById, stopsForTrip } from '@shared/itineraries.ts'
import { allHarbors, harborIdFromStop, harborStop, harborTz } from '@shared/harbors.ts'
import { harborLocalToIso, isoToHarborLocal } from '@shared/time.ts'
import type { PortStop, Trip } from '@shared/types.ts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DateField } from '@/components/ui/date-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type DraftStop = {
  key: string
  harborId: string
  arriveDate: string
  arriveTime: string
  departDate: string
  departTime: string
}

type TripSetupDialogProps = {
  open: boolean
  trip: Trip | null
  onOpenChange: (open: boolean) => void
  onSave: (trip: Trip) => void | Promise<void>
}

export function TripSetupDialog({ open, trip, onOpenChange, onSave }: TripSetupDialogProps) {
  const { t, i18n } = useTranslation()
  const presets = useMemo(() => itineraryPresets(), [])
  const lines = useMemo(() => cruiseLines(), [])
  const german = i18n.language.startsWith('de')
  const locale = german ? 'de' : 'en'

  const [lineId, setLineId] = useState(lines[0].id)
  const [shipId, setShipId] = useState(presets.find((preset) => preset.shipId)?.shipId ?? '')
  const [presetId, setPresetId] = useState('ais')
  const [startDate, setStartDate] = useState(todayYmd())
  const [endDate, setEndDate] = useState(todayYmd())
  const [draftStops, setDraftStops] = useState<DraftStop[]>([])
  const [customName, setCustomName] = useState('')
  const [customMmsi, setCustomMmsi] = useState('')
  const [customImo, setCustomImo] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const lineShips = shipsForLine(lineId)
  const harbors = useMemo(
    () => allHarbors().sort((a, b) => (german ? a.nameDe : a.name).localeCompare(german ? b.nameDe : b.name)),
    [german],
  )

  useEffect(() => {
    if (!open) return
    const current = trip ? tripShip(trip) : undefined
    const nextLine = current?.lineId && current.lineId !== 'custom' ? current.lineId : lines[0].id
    const nextShip = trip?.shipId === CUSTOM_SHIP_ID ? CUSTOM_SHIP_ID : (current?.id ?? shipsForLine(nextLine)[0]?.id)
    const storedPreset = trip?.presetId && (trip.presetId === 'custom' || presetById(trip.presetId))
      ? trip.presetId
      : trip?.stops.length
        ? 'custom'
        : 'ais'
    setLineId(nextLine)
    setShipId(nextShip)
    setPresetId(storedPreset)
    setStartDate(trip?.startDate ?? todayYmd())
    setEndDate(trip?.endDate ?? todayYmd())
    setDraftStops(trip?.stops.length ? trip.stops.map(toDraftStop) : [])
    setCustomName(trip?.customShip?.name ?? current?.name ?? '')
    setCustomMmsi(trip?.mmsi || trip?.customShip?.mmsi || current?.mmsi || '')
    setCustomImo(trip?.imo || trip?.customShip?.imo || current?.imo || '')
    setSaveError(false)
    setBusy(false)
  }, [lines, open, trip])

  function changeLine(id: string) {
    setLineId(id)
    const first = shipsForLine(id)[0]
    if (first) changeShip(first.id)
  }

  function changeShip(id: string) {
    setShipId(id)
    const catalog = id === CUSTOM_SHIP_ID ? undefined : shipById(id)
    if (catalog) {
      setCustomName(catalog.name)
      setCustomMmsi(catalog.mmsi)
      setCustomImo(catalog.imo)
    }
  }

  function applyPreset(id: string) {
    setPresetId(id)
    if (id === 'ais') {
      setDraftStops([])
      return
    }
    const filled = stopsForTrip(id, startDate)
    setDraftStops(filled.map(toDraftStop))
    if (filled.length) {
      setStartDate(toDateInput(filled[0].arriveAt))
      setEndDate(toDateInput(filled[filled.length - 1].departAt))
    }
  }

  function updateStop(key: string, patch: Partial<DraftStop>) {
    setPresetId((current) => (current === 'ais' ? 'custom' : current === 'custom' ? current : 'custom'))
    setDraftStops((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function addStop() {
    const last = draftStops[draftStops.length - 1]
    const harborId = last?.harborId ?? harbors[0]?.id ?? 'barcelona'
    const date = last?.departDate || startDate || todayYmd()
    setPresetId((current) => (current === 'ais' ? 'custom' : current))
    setDraftStops((rows) => [
      ...rows,
      {
        key: newStopKey(),
        harborId,
        arriveDate: date,
        arriveTime: '08:00',
        departDate: date,
        departTime: '17:00',
      },
    ])
  }

  function removeStop(key: string) {
    setDraftStops((rows) => rows.filter((row) => row.key !== key))
    setPresetId((current) => (current === 'ais' ? current : 'custom'))
  }

  async function submit() {
    const line = lines.find((item) => item.id === lineId)
    const catalog = shipId === CUSTOM_SHIP_ID ? undefined : shipById(shipId)
    const mmsi = (customMmsi || catalog?.mmsi || '').replace(/\D/g, '')
    const imo = (customImo || catalog?.imo || '').replace(/\D/g, '')
    if (!mmsi || mmsi.length < 9) {
      setSaveError(true)
      return
    }
    if (shipId === CUSTOM_SHIP_ID && !customName.trim()) return
    const stops = draftStops.map(fromDraftStop).filter((stop): stop is PortStop => Boolean(stop))
    const nextPreset = stops.length === 0 ? 'ais' : presetId === 'ais' ? 'custom' : presetId
    setBusy(true)
    setSaveError(false)
    try {
      await onSave({
        id: trip?.id || mmsi || catalog?.mmsi || shipId,
        shipId,
        mmsi,
        imo: imo || undefined,
        customShip:
          shipId === CUSTOM_SHIP_ID
            ? {
                name: customName.trim(),
                mmsi,
                imo: imo || undefined,
                line: line?.name ?? 'Custom',
                lineDe: line?.nameDe ?? 'Eigene Angabe',
              }
            : undefined,
        presetId: nextPreset,
        startDate,
        endDate,
        stops,
      })
      onOpenChange(false)
    } catch {
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('setupTitle')}</DialogTitle>
          <DialogDescription>{t('setupHint')}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          <div className="space-y-2">
            <Label>{t('cruiseLine')}</Label>
            <Select value={lineId} onValueChange={changeLine}>
              <SelectTrigger aria-label={t('cruiseLine')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lines.map((line) => (
                  <SelectItem key={line.id} value={line.id}>
                    {german ? line.nameDe : line.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('ship')}</Label>
            <Select value={shipId} onValueChange={changeShip}>
              <SelectTrigger aria-label={t('ship')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lineShips.map((ship) => (
                  <SelectItem key={ship.id} value={ship.id}>
                    {ship.name}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_SHIP_ID}>{t('customShip')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {shipId === CUSTOM_SHIP_ID ? (
            <div className="space-y-2">
              <Label htmlFor="custom-name">{t('customShipName')}</Label>
              <Input id="custom-name" value={customName} onChange={(event) => setCustomName(event.target.value)} />
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="custom-mmsi">{t('customMmsi')}</Label>
              <Input
                id="custom-mmsi"
                inputMode="numeric"
                value={customMmsi}
                onChange={(event) => setCustomMmsi(event.target.value)}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">{t('mmsiHint')}</p>
              <a
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                href={`https://www.vesselfinder.com/vessels?name=${encodeURIComponent(customName.trim() || shipById(shipId)?.name || 'Legend of the Seas')}`}
                target="_blank"
                rel="noreferrer"
              >
                {t('mmsiLookup')}
              </a>
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-imo">{t('customImo')}</Label>
              <Input
                id="custom-imo"
                inputMode="numeric"
                value={customImo}
                onChange={(event) => setCustomImo(event.target.value)}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">{t('imoHint')}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('route')}</Label>
            <Select
              value={presetId}
              onValueChange={(id) => {
                if (id === 'custom') return
                applyPreset(id)
              }}
            >
              <SelectTrigger aria-label={t('route')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {german ? preset.titleDe : preset.title}
                  </SelectItem>
                ))}
                {presetId === 'custom' ? <SelectItem value="custom">{t('routeCustom')}</SelectItem> : null}
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('pocHint')}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start-date">{t('startDate')}</Label>
              <DateField id="start-date" value={startDate} onChange={setStartDate} locale={locale} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">{t('endDate')}</Label>
              <DateField id="end-date" value={endDate} onChange={setEndDate} locale={locale} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('pocs')}</Label>
            {draftStops.length ? (
              <ul className="flex flex-col gap-3">
                {draftStops.map((stop, index) => (
                  <li key={stop.key} className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border/50">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {t('pocLabel')} {index + 1}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 min-h-11 whitespace-normal"
                        onClick={() => removeStop(stop.key)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {t('removeStop')}
                      </Button>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>{t('harbor')}</Label>
                        <Select value={stop.harborId} onValueChange={(value) => updateStop(stop.key, { harborId: value })}>
                          <SelectTrigger aria-label={t('harbor')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {harbors.map((harbor) => (
                              <SelectItem key={harbor.id} value={harbor.id}>
                                {german ? harbor.nameDe : harbor.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DateTimeFields
                          id={`${stop.key}-arrive`}
                          label={t('arrival')}
                          date={stop.arriveDate}
                          time={stop.arriveTime}
                          locale={locale}
                          onDate={(value) => updateStop(stop.key, { arriveDate: value })}
                          onTime={(value) => updateStop(stop.key, { arriveTime: value })}
                        />
                        <DateTimeFields
                          id={`${stop.key}-depart`}
                          label={t('departLabel')}
                          date={stop.departDate}
                          time={stop.departTime}
                          locale={locale}
                          onDate={(value) => updateStop(stop.key, { departDate: value })}
                          onTime={(value) => updateStop(stop.key, { departTime: value })}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{t('localTimeHint')}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">{t('pocEmpty')}</p>
            )}
            <Button type="button" variant="secondary" className="w-full whitespace-normal" onClick={addStop}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('addStop')}
            </Button>
          </div>
          <Button type="button" size="lg" className="mt-2" disabled={busy} onClick={() => void submit()}>
            {t('saveTrip')}
          </Button>
          {saveError ? (
            <p className="text-sm text-destructive" role="alert">
              {t('tripSaveFailed')}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DateTimeFields({
  id,
  label,
  date,
  time,
  locale,
  onDate,
  onTime,
}: {
  id: string
  label: string
  date: string
  time: string
  locale: 'de' | 'en'
  onDate: (value: string) => void
  onTime: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-date`}>{label}</Label>
      <DateField id={`${id}-date`} value={date} onChange={onDate} locale={locale} />
      <Input
        id={`${id}-time`}
        type="time"
        value={time}
        onChange={(event) => onTime(event.target.value)}
        aria-label={label}
      />
    </div>
  )
}

function toDraftStop(stop: PortStop): DraftStop {
  const harborId = harborIdFromStop(stop)
  const tz = harborTz(harborId)
  const arrive = isoToHarborLocal(stop.arriveAt, tz)
  const depart = isoToHarborLocal(stop.departAt, tz)
  return {
    key: stop.id || newStopKey(),
    harborId,
    arriveDate: arrive.date,
    arriveTime: arrive.time,
    departDate: depart.date,
    departTime: depart.time,
  }
}

function fromDraftStop(stop: DraftStop): PortStop | null {
  if (!stop.harborId || !stop.arriveDate || !stop.arriveTime || !stop.departDate || !stop.departTime) return null
  const tz = harborTz(stop.harborId)
  const used = stop.harborId
  return harborStop(
    used,
    `${used}-${stop.arriveDate}-${stop.arriveTime.replace(':', '')}`,
    harborLocalToIso(stop.arriveDate, stop.arriveTime, tz),
    harborLocalToIso(stop.departDate, stop.departTime, tz),
  )
}

function newStopKey(): string {
  return `stop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function toDateInput(iso: string): string {
  return iso.slice(0, 10)
}

function todayYmd(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
