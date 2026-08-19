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
import type { DataDockedStatus } from '@shared/types.ts'

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onEditTrip: () => void
}

export function SettingsDialog({ open, onOpenChange, onEditTrip }: SettingsDialogProps) {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { logout, isAdmin } = useAuth()
  const [lang, setLang] = useState(i18n.language.startsWith('de') ? 'de' : 'en')
  const [trackerOn, setTrackerOn] = useState(false)
  const [dataDocked, setDataDocked] = useState<DataDockedStatus | null>(null)
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
      .then((data: { aisConfigured?: boolean; dataDocked?: DataDockedStatus } | null) => {
        setTrackerOn(Boolean(data?.aisConfigured))
        setDataDocked(data?.dataDocked ?? null)
        if (data?.dataDocked?.intervalHours) {
          setIntervalHours(String(data.dataDocked.intervalHours === 1 ? 1 : 3))
        }
        setIntervalMsg(null)
        setFetchMsg(null)
      })
      .catch(() => {
        setTrackerOn(false)
        setDataDocked(null)
      })
    void notificationState().then(setPush)
    if (isAdmin) {
      void fetch('/api/manual-position', { credentials: 'include' })
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
  }, [open, isAdmin])

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
    void fetch('/api/manual-position', { method: 'DELETE', credentials: 'include' })
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
                  {trackerOn ? t('trackingLive') : t('trackingOff')}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">{dataDockedLine()}</p>
              </div>
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
          {isAdmin ? (
            <Button
              variant="secondary"
              onClick={() => {
                onOpenChange(false)
                onEditTrip()
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
      onSubmitted={() => {
        void fetch('/api/manual-position', { credentials: 'include' })
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
