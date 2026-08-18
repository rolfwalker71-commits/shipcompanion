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
  const { logout } = useAuth()
  const [lang, setLang] = useState(i18n.language.startsWith('de') ? 'de' : 'en')
  const [trackerOn, setTrackerOn] = useState(false)
  const [dataDocked, setDataDocked] = useState<DataDockedStatus | null>(null)
  const [push, setPush] = useState<'unsupported' | 'denied' | 'off' | 'on'>('off')
  const [pushBusy, setPushBusy] = useState(false)

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
      })
      .catch(() => {
        setTrackerOn(false)
        setDataDocked(null)
      })
    void notificationState().then(setPush)
  }, [open])

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
    const when = dataDocked.nextFetchAt ? formatWhen(dataDocked.nextFetchAt, locale) : t('trackingDockedSoon')
    return `${credits} ${t('trackingDockedNext', { when })}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings')}</DialogTitle>
          <DialogDescription>{t('setupHint')}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
          <div className="space-y-1">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {trackerOn ? t('trackingLive') : t('trackingOff')}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{dataDockedLine()}</p>
          </div>
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
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false)
              onEditTrip()
            }}
          >
            {t('editTrip')}
          </Button>
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
  )
}
