import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CUSTOM_SHIP_ID, cruiseLines, shipsForLine, tripShip } from '@shared/ships.ts'
import { itineraryPresets, presetById, stopsForTrip } from '@shared/itineraries.ts'
import type { Trip } from '@shared/types.ts'
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

  const [lineId, setLineId] = useState(lines[0].id)
  const [shipId, setShipId] = useState(presets[0].shipId)
  const [presetId, setPresetId] = useState(presets[0].id)
  const [startDate, setStartDate] = useState(toDateInput(presets[0].stops[0].arriveAt))
  const [endDate, setEndDate] = useState(toDateInput(presets[0].stops[presets[0].stops.length - 1].departAt))
  const [customName, setCustomName] = useState('')
  const [customMmsi, setCustomMmsi] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const lineShips = shipsForLine(lineId)

  useEffect(() => {
    if (!open) return
    const current = trip ? tripShip(trip) : undefined
    const nextLine = current?.lineId && current.lineId !== 'custom' ? current.lineId : lines[0].id
    const nextShip = trip?.shipId === CUSTOM_SHIP_ID ? CUSTOM_SHIP_ID : (current?.id ?? shipsForLine(nextLine)[0]?.id)
    const preset = trip?.presetId ? presetById(trip.presetId) : presets[0]
    setLineId(nextLine)
    setShipId(nextShip)
    setPresetId(preset?.id ?? presets[0].id)
    setStartDate(trip?.startDate ?? toDateInput((preset ?? presets[0]).stops[0].arriveAt))
    setEndDate(trip?.endDate ?? toDateInput((preset ?? presets[0]).stops[(preset ?? presets[0]).stops.length - 1].departAt))
    setCustomName(trip?.customShip?.name ?? '')
    setCustomMmsi(trip?.customShip?.mmsi ?? '')
    setSaveError(false)
    setBusy(false)
  }, [lines, open, presets, trip])

  function changeLine(id: string) {
    setLineId(id)
    const first = shipsForLine(id)[0]
    if (first) changeShip(first.id)
  }

  function changeShip(id: string) {
    setShipId(id)
    const match = presets.find((preset) => preset.shipId === id)
    if (match) applyPreset(match.id)
  }

  function applyPreset(id: string) {
    const preset = presetById(id)
    if (!preset) return
    setPresetId(id)
    setStartDate(toDateInput(preset.stops[0].arriveAt))
    setEndDate(toDateInput(preset.stops[preset.stops.length - 1].departAt))
  }

  async function submit() {
    const preset = presetById(presetId) ?? presets[0]
    const line = lines.find((item) => item.id === lineId)
    const mmsi = customMmsi.replace(/\D/g, '')
    if (shipId === CUSTOM_SHIP_ID && (!customName.trim() || mmsi.length < 9)) return
    setBusy(true)
    setSaveError(false)
    try {
      await onSave({
        shipId,
        customShip:
          shipId === CUSTOM_SHIP_ID
            ? {
                name: customName.trim(),
                mmsi,
                line: line?.name ?? 'Custom',
                lineDe: line?.nameDe ?? 'Eigene Angabe',
              }
            : undefined,
        presetId: preset.id,
        startDate,
        endDate,
        stops: stopsForTrip(preset.id, startDate),
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="custom-name">{t('customShipName')}</Label>
                <Input id="custom-name" value={customName} onChange={(event) => setCustomName(event.target.value)} />
              </div>
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
                  href={`https://www.vesselfinder.com/vessels?name=${encodeURIComponent(customName.trim() || 'Legend of the Seas')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('mmsiLookup')}
                </a>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>{t('route')}</Label>
            <Select value={presetId} onValueChange={applyPreset}>
              <SelectTrigger aria-label={t('route')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {german ? preset.titleDe : preset.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start-date">{t('startDate')}</Label>
              <DateField
                id="start-date"
                value={startDate}
                onChange={setStartDate}
                locale={german ? 'de' : 'en'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">{t('endDate')}</Label>
              <DateField
                id="end-date"
                value={endDate}
                onChange={setEndDate}
                locale={german ? 'de' : 'en'}
              />
            </div>
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

function toDateInput(iso: string): string {
  return iso.slice(0, 10)
}
