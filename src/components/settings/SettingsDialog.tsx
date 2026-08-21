import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatWhen } from '@shared/time.ts'
import { useTheme, type Theme } from '@/lib/theme'
import { useAuth } from '@/lib/auth'
import { ManualPositionDialog } from '@/components/home/ManualPositionDialog'
import { disablePush, enablePush, notificationState, pushSupported } from '@/lib/push'
import type { DataDockedStatus, Trip, VesselsApiStatus } from '@shared/types.ts'
import { tripKey, tripShip } from '@shared/ships.ts'

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  ships?: Trip[]
  selectedId?: string | null
  selectedMmsi?: string
  onSelectShip?: (id: string) => void
  onAddShip?: () => void
  onEditShip?: (id: string) => void
  onRemoveShip?: (id: string) => void | Promise<void>
}

export function SettingsDialog({
  open,
  onOpenChange,
  ships = [],
  selectedId = null,
  selectedMmsi = '',
  onSelectShip,
  onAddShip,
  onEditShip,
  onRemoveShip,
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { logout, isAdmin } = useAuth()
  const [lang, setLang] = useState(i18n.language.startsWith('de') ? 'de' : 'en')
  const [trackerOn, setTrackerOn] = useState(false)
  const [dataDocked, setDataDocked] = useState<DataDockedStatus | null>(null)
  const [vesselsApi, setVesselsApi] = useState<VesselsApiStatus | null>(null)
  const [vesselsMinutes, setVesselsMinutes] = useState('30')
  const [vesselsBusy, setVesselsBusy] = useState(false)
  const [vesselsMsg, setVesselsMsg] = useState<'ok' | 'bad' | 'forbidden' | null>(null)
  const [vesselsFetchBusy, setVesselsFetchBusy] = useState(false)
  const [vesselsFetchMsg, setVesselsFetchMsg] = useState<'ok' | 'bad' | 'forbidden' | null>(null)
  const [removeBusy, setRemoveBusy] = useState<string | null>(null)
  const [intervalHours, setIntervalHours] = useState('3')
  const [intervalBusy, setIntervalBusy] = useState(false)
  const [intervalMsg, setIntervalMsg] = useState<'ok' | 'bad' | 'forbidden' | null>(null)
  const [fetchBusy, setFetchBusy] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<'ok' | 'bad' | 'forbidden' | 'no_credits' | 'no_mmsi' | null>(null)
  const [push, setPush] = useState<'unsupported' | 'denied' | 'off' | 'on'>('off')
  const [pushBusy, setPushBusy] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [lastManual, setLastManual] = useState<{
    at: string
    accuracyM: number | null
    postedBy: string | null
  } | null>(null)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearMsg, setClearMsg] = useState<'ok' | 'bad' | 'forbidden' | null>(null)

  useEffect(() => {
    setLang(i18n.language.startsWith('de') ? 'de' : 'en')
  }, [i18n.language])

  useEffect(() => {
    if (!open) return
    void fetch('/api/status', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { aisConfigured?: boolean; dataDocked?: DataDockedStatus; vesselsApi?: VesselsApiStatus } | null) => {
        setTrackerOn(Boolean(data?.aisConfigured))
        setDataDocked(data?.dataDocked ?? null)
        setVesselsApi(data?.vesselsApi ?? null)
        if (data?.dataDocked?.intervalHours) {
          setIntervalHours(String(data.dataDocked.intervalHours === 1 ? 1 : 3))
        }
        if (data?.vesselsApi?.intervalMinutes) {
          setVesselsMinutes(String(data.vesselsApi.intervalMinutes === 60 ? 60 : 30))
        }
        setIntervalMsg(null)
        setFetchMsg(null)
        setVesselsMsg(null)
        setVesselsFetchMsg(null)
      })
      .catch(() => {
        setTrackerOn(false)
        setDataDocked(null)
        setVesselsApi(null)
      })
    void notificationState().then(setPush)
    if (isAdmin) {
      const qs = selectedMmsi ? `?mmsi=${encodeURIComponent(selectedMmsi)}` : ''
      void fetch(`/api/manual-position${qs}`, { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (data: {
            fix?: { at: string; accuracyM: number | null; postedBy: string | null } | null
          } | null) => {
            setLastManual(data?.fix ?? null)
            setClearMsg(null)
          },
        )
        .catch(() => setLastManual(null))
    }
  }, [open, isAdmin, selectedMmsi])

  const locale = lang === 'en' ? 'en' : 'de'

  function dataDockedLine(): string {
    if (!dataDocked?.configured) return t('trackingDockedOff')
    const credits =
      dataDocked.credits != null
        ? t('trackingDockedCredits', { credits: dataDocked.credits })
        : t('trackingDockedQuota', { used: dataDocked.usedThisMonth, limit: dataDocked.monthlyLimit })
    if (dataDocked.credits === 0 || dataDocked.remaining <= 0) {
      return `${credits} ${t('trackingDockedEmpty')}`
    }
    if (dataDocked.lastError) {
      return `${credits} ${t('trackingDockedError', { error: dataDocked.lastError })}`
    }
    const when = dataDocked.nextFetchAt ? formatWhen(dataDocked.nextFetchAt, locale) : t('trackingDockedSoon')
    return `${credits} ${t('trackingDockedInterval', { hours: dataDocked.intervalHours })} ${t('trackingDockedNext', { when })}`
  }

  function vesselsLine(): string {
    if (!vesselsApi?.configured) return t('trackingVesselsOff')
    if (vesselsApi.lastError) {
      return t('trackingVesselsError', { error: vesselsApi.lastError })
    }
    const when = vesselsApi.nextFetchAt ? formatWhen(vesselsApi.nextFetchAt, locale) : t('trackingDockedSoon')
    const line = t('trackingVesselsOn', { minutes: vesselsApi.intervalMinutes, when, count: vesselsApi.vesselCount })
    if (vesselsApi.lastHistoryError) {
      return `${line} ${t('trackingVesselsHistoryError', { error: vesselsApi.lastHistoryError })}`
    }
    return line
  }

  function saveVesselsInterval() {
    setVesselsBusy(true)
    setVesselsMsg(null)
    void fetch('/api/vessels/interval', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: Number(vesselsMinutes) }),
    })
      .then(async (res) => {
        if (res.status === 403) {
          setVesselsMsg('forbidden')
          return
        }
        if (!res.ok) {
          setVesselsMsg('bad')
          return
        }
        const data = (await res.json()) as { vesselsApi?: VesselsApiStatus }
        if (data.vesselsApi) setVesselsApi(data.vesselsApi)
        setVesselsMsg('ok')
      })
      .catch(() => setVesselsMsg('bad'))
      .finally(() => setVesselsBusy(false))
  }

  function fetchVesselsNow() {
    setVesselsFetchBusy(true)
    setVesselsFetchMsg(null)
    void fetch('/api/vessels/fetch', { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { vesselsApi?: VesselsApiStatus } | null
        if (data?.vesselsApi) setVesselsApi(data.vesselsApi)
        if (res.status === 403) {
          setVesselsFetchMsg('forbidden')
          return
        }
        if (!res.ok) {
          setVesselsFetchMsg('bad')
          return
        }
        setVesselsFetchMsg('ok')
      })
      .catch(() => setVesselsFetchMsg('bad'))
      .finally(() => setVesselsFetchBusy(false))
  }

  function saveInterval() {
    setIntervalBusy(true)
    setIntervalMsg(null)
    void fetch('/api/datadocked/interval', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours: Number(intervalHours) }),
    })
      .then(async (res) => {
        if (res.status === 403) {
          setIntervalMsg('forbidden')
          return
        }
        if (!res.ok) {
          setIntervalMsg('bad')
          return
        }
        const data = (await res.json()) as { dataDocked?: DataDockedStatus }
        if (data.dataDocked) setDataDocked(data.dataDocked)
        setIntervalMsg('ok')
      })
      .catch(() => setIntervalMsg('bad'))
      .finally(() => setIntervalBusy(false))
  }

  function fetchDataDockedNow() {
    setFetchBusy(true)
    setFetchMsg(null)
    void fetch('/api/datadocked/fetch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mmsi: selectedMmsi || undefined }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          error?: string
          dataDocked?: DataDockedStatus
        } | null
        if (data?.dataDocked) setDataDocked(data.dataDocked)
        if (res.status === 403) {
          setFetchMsg('forbidden')
          return
        }
        if (res.status === 429 || data?.error === 'no_credits') {
          setFetchMsg('no_credits')
          return
        }
        if (data?.error === 'no_mmsi') {
          setFetchMsg('no_mmsi')
          return
        }
        if (!res.ok) {
          setFetchMsg('bad')
          return
        }
        setFetchMsg('ok')
      })
      .catch(() => setFetchMsg('bad'))
      .finally(() => setFetchBusy(false))
  }

  function clearManual() {
    setClearBusy(true)
    setClearMsg(null)
    void fetch(`/api/manual-position${selectedMmsi ? `?mmsi=${encodeURIComponent(selectedMmsi)}` : ''}`, { method: 'DELETE', credentials: 'include' })
      .then((res) => {
        if (res.status === 403) {
          setClearMsg('forbidden')
          return
        }
        if (!res.ok) {
          setClearMsg('bad')
          return
        }
        setLastManual(null)
        setClearMsg('ok')
      })
      .catch(() => setClearMsg('bad'))
      .finally(() => setClearBusy(false))
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings')}</DialogTitle>
          <DialogDescription>{isAdmin ? t('settingsAdminHint') : t('settingsHint')}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          {isAdmin ? (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium leading-snug">{t('fleetTitle')}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('fleetHint')}</p>
                <div className="flex flex-col gap-2">
                  {ships.map((row) => {
                    const id = tripKey(row)
                    const ship = tripShip(row)
                    const name = ship?.name ?? row.shipId
                    const active = id === selectedId
                    const ids = [ship?.imo ? `IMO ${ship.imo}` : null, ship?.mmsi ? `MMSI ${ship.mmsi}` : null]
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <div key={id} className="flex items-start gap-2">
                        <Button
                          variant={active ? 'default' : 'secondary'}
                          className="h-auto min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 py-2 text-left whitespace-normal"
                          onClick={() => onSelectShip?.(id)}
                        >
                          <span>{name}</span>
                          {ids ? (
                            <span className={active ? 'text-xs font-normal text-primary-foreground/80' : 'text-xs font-normal text-muted-foreground'}>
                              {ids}
                            </span>
                          ) : null}
                        </Button>
                        {onEditShip ? (
                          <Button
                            variant="secondary"
                            size="icon"
                            className="shrink-0"
                            aria-label={t('fleetEdit')}
                            onClick={() => {
                              onSelectShip?.(id)
                              onOpenChange(false)
                              onEditShip(id)
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {onRemoveShip ? (
                          <Button
                            variant="destructive"
                            size="icon"
                            className="shrink-0"
                            aria-label={t('fleetRemove')}
                            disabled={removeBusy === id}
                            onClick={() => {
                              setRemoveBusy(id)
                              void Promise.resolve(onRemoveShip(id)).finally(() => setRemoveBusy(null))
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                {onAddShip ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      onOpenChange(false)
                      onAddShip()
                    }}
                  >
                    {t('fleetAdd')}
                  </Button>
                ) : null}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium leading-snug">{t('manualPositionTitle')}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('manualPositionSettingsHint')}</p>
                {lastManual ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t('manualPositionLast', { when: formatWhen(lastManual.at, locale) })}
                    {lastManual.accuracyM != null
                      ? ` · ${t('manualPositionAccuracy', { meters: Math.round(lastManual.accuracyM) })}`
                      : ''}
                    {lastManual.postedBy ? ` · ${lastManual.postedBy}` : ''}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    onOpenChange(false)
                    setReportOpen(true)
                  }}
                >
                  {t('manualPositionOpen')}
                </Button>
                {lastManual ? (
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={clearBusy}
                    onClick={clearManual}
                  >
                    {t('manualPositionClear')}
                  </Button>
                ) : null}
                {clearMsg === 'ok' ? (
                  <p className="text-sm text-foreground" role="status">
                    {t('manualPositionClearOk')}
                  </p>
                ) : null}
                {clearMsg && clearMsg !== 'ok' ? (
                  <p className="text-sm text-destructive" role="alert">
                    {clearMsg === 'forbidden' ? t('settingsForbidden') : t('tripSaveFailed')}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {vesselsLine()}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {trackerOn ? t('trackingLive') : t('trackingOff')}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">{dataDockedLine()}</p>
              </div>
              {vesselsApi?.configured ? (
                <div className="space-y-2">
                  <Label htmlFor="vessels-interval">{t('vesselsInterval')}</Label>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t('vesselsIntervalHint')}</p>
                  <Select value={vesselsMinutes} onValueChange={setVesselsMinutes} disabled={vesselsBusy}>
                    <SelectTrigger id="vessels-interval" aria-label={t('vesselsInterval')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">{t('vesselsInterval30')}</SelectItem>
                      <SelectItem value="60">{t('vesselsInterval60')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" className="w-full" disabled={vesselsBusy} onClick={saveVesselsInterval}>
                    {t('vesselsIntervalSave')}
                  </Button>
                  {vesselsMsg === 'ok' ? (
                    <p className="text-sm text-foreground" role="status">
                      {t('vesselsIntervalSaved')}
                    </p>
                  ) : null}
                  {vesselsMsg && vesselsMsg !== 'ok' ? (
                    <p className="text-sm text-destructive" role="alert">
                      {vesselsMsg === 'forbidden' ? t('settingsForbidden') : t('tripSaveFailed')}
                    </p>
                  ) : null}
                  <p className="text-sm leading-relaxed text-muted-foreground">{t('vesselsFetchHint')}</p>
                  <Button
                    variant="default"
                    className="w-full whitespace-normal"
                    disabled={vesselsFetchBusy}
                    onClick={fetchVesselsNow}
                  >
                    {vesselsFetchBusy ? t('vesselsFetchBusy') : t('vesselsFetchNow')}
                  </Button>
                  {vesselsFetchMsg === 'ok' ? (
                    <p className="text-sm text-foreground" role="status">
                      {t('vesselsFetchOk')}
                    </p>
                  ) : null}
                  {vesselsFetchMsg && vesselsFetchMsg !== 'ok' ? (
                    <p className="text-sm text-destructive" role="alert">
                      {vesselsFetchMsg === 'forbidden' ? t('settingsForbidden') : t('vesselsFetchFailed')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {dataDocked?.configured ? (
                <div className="space-y-2">
                  <Label htmlFor="docked-interval">{t('dockedInterval')}</Label>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t('dockedIntervalHint')}</p>
                  <Select value={intervalHours} onValueChange={setIntervalHours} disabled={intervalBusy}>
                    <SelectTrigger id="docked-interval" aria-label={t('dockedInterval')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">{t('dockedInterval3')}</SelectItem>
                      <SelectItem value="1">{t('dockedInterval1')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" className="w-full" disabled={intervalBusy} onClick={saveInterval}>
                    {t('dockedIntervalSave')}
                  </Button>
                  {intervalMsg === 'ok' ? (
                    <p className="text-sm text-foreground" role="status">
                      {t('dockedIntervalSaved')}
                    </p>
                  ) : null}
                  {intervalMsg && intervalMsg !== 'ok' ? (
                    <p className="text-sm text-destructive" role="alert">
                      {intervalMsg === 'forbidden' ? t('settingsForbidden') : t('tripSaveFailed')}
                    </p>
                  ) : null}
                  <p className="text-sm leading-relaxed text-muted-foreground">{t('dockedFetchHint')}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t('dockedRemaining', {
                      count: dataDocked.credits ?? dataDocked.remaining,
                    })}
                  </p>
                  <Button
                    variant="default"
                    className="w-full whitespace-normal"
                    disabled={fetchBusy}
                    onClick={fetchDataDockedNow}
                  >
                    {fetchBusy ? t('dockedFetchBusy') : t('dockedFetchNow')}
                  </Button>
                  {fetchMsg === 'ok' ? (
                    <p className="text-sm text-foreground" role="status">
                      {t('dockedFetchOk')}
                    </p>
                  ) : null}
                  {fetchMsg && fetchMsg !== 'ok' ? (
                    <p className="text-sm text-destructive" role="alert">
                      {fetchMsg === 'forbidden'
                        ? t('settingsForbidden')
                        : fetchMsg === 'no_credits'
                          ? t('dockedFetchNoCredits')
                          : fetchMsg === 'no_mmsi'
                            ? t('dockedFetchNoTrip')
                            : dataDocked.lastError
                              ? t('dockedFetchFailedDetail', { error: dataDocked.lastError })
                              : t('dockedFetchFailed')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="push-toggle">{t('pushEnable')}</Label>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {import.meta.env.DEV
                  ? t('pushHintDev')
                  : push === 'denied'
                    ? t('pushDenied')
                    : push === 'unsupported'
                      ? t('pushUnsupported')
                      : t('pushHint')}
              </p>
            </div>
            <Switch
              id="push-toggle"
              checked={push === 'on'}
              disabled={
                pushBusy ||
                import.meta.env.DEV ||
                push === 'denied' ||
                push === 'unsupported' ||
                !pushSupported()
              }
              onCheckedChange={(checked) => {
                setPushBusy(true)
                void (checked ? enablePush() : disablePush().then(() => 'off' as const))
                  .then((state) => {
                    if (state === 'on' || state === 'denied' || state === 'unsupported') setPush(state)
                    else if (state === 'error') setPush('off')
                    else setPush('off')
                  })
                  .finally(() => setPushBusy(false))
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('language')}</Label>
            <Select
              value={lang}
              onValueChange={(value) => {
                setLang(value)
                void i18n.changeLanguage(value)
                localStorage.setItem('cruise-locale', value)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="de">Deutsch</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('theme')}</Label>
            <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t('themeSystem')}</SelectItem>
                <SelectItem value="light">{t('themeLight')}</SelectItem>
                <SelectItem value="dark">{t('themeDark')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isAdmin && onEditShip && selectedId ? (
            <Button
              variant="secondary"
              onClick={() => {
                onOpenChange(false)
                onEditShip(selectedId)
              }}
            >
              {t('editTrip')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              void logout()
              onOpenChange(false)
            }}
          >
            {t('logout')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <ManualPositionDialog
      open={reportOpen}
      onOpenChange={setReportOpen}
      mmsi={selectedMmsi || undefined}
      onSubmitted={() => {
        const qs = selectedMmsi ? `?mmsi=${encodeURIComponent(selectedMmsi)}` : ''
        void fetch(`/api/manual-position${qs}`, { credentials: 'include' })
          .then((res) => (res.ok ? res.json() : null))
          .then(
            (data: {
              fix?: { at: string; accuracyM: number | null; postedBy: string | null } | null
            } | null) => {
              setLastManual(data?.fix ?? null)
            },
          )
          .catch(() => {})
      }}
    />
    </>
  )
}
