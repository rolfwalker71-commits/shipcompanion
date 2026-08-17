import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Ship, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'

export function LoginScreen() {
  const { t, i18n } = useTranslation()
  const { login } = useAuth()
  const { resolved, setTheme } = useTheme()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const nextLang = i18n.language.startsWith('de') ? 'en' : 'de'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!key.trim()) {
      setError(t('loginRequired'))
      return
    }
    setPending(true)
    setError(null)
    const result = await login(key)
    setPending(false)
    if (result === 'invalid') setError(t('loginError'))
    if (result === 'busy') setError(t('loginBusy'))
    if (result === 'session') setError(t('loginSession'))
    if (result === 'error') setError(t('statusError'))
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Ship className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t('appName')}</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('language')}
            onClick={() => {
              void i18n.changeLanguage(nextLang)
              localStorage.setItem('cruise-locale', nextLang)
            }}
          >
            <span className="text-sm font-semibold">{nextLang === 'de' ? 'DE' : 'EN'}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('theme')}
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            {resolved === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
        </div>
      </div>
      <form onSubmit={(event) => void onSubmit(event)} className="rounded-3xl bg-card p-6 shadow-sm ring-1 ring-border/50">
        <h2 className="text-3xl font-semibold leading-snug">{t('loginTitle')}</h2>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{t('loginHint')}</p>
        <div className="mt-8 space-y-2">
          <Label htmlFor="family-key">{t('loginPlaceholder')}</Label>
          <Input
            id="family-key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className="h-14 min-h-14 text-lg"
          />
        </div>
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="mt-6 w-full" disabled={pending}>
          {t('loginSubmit')}
        </Button>
      </form>
    </main>
  )
}
