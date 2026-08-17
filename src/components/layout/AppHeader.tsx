import { Moon, Settings, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'

type AppHeaderProps = {
  onOpenSettings: () => void
}

export function AppHeader({ onOpenSettings }: AppHeaderProps) {
  const { t, i18n } = useTranslation()
  const { resolved, setTheme } = useTheme()
  const nextLang = i18n.language.startsWith('de') ? 'en' : 'de'

  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-card/90 pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur-md sm:pr-6 sm:pl-6">
      <div className="flex min-h-14 min-w-0 items-center gap-2 sm:gap-3">
        <Ship className="h-5 w-5 shrink-0 fill-sky-100 text-sky-700 sm:h-6 sm:w-6" aria-hidden />
        <h1 className="truncate text-base font-semibold tracking-tight sm:text-xl">{t('appName')}</h1>
        {import.meta.env.DEV ? (
          <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
            DEV
          </span>
        ) : null}
      </div>
      <div className="flex min-h-14 shrink-0 items-center gap-0.5 sm:gap-1">
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
          {resolved === 'dark' ? (
            <Sun className="h-5 w-5 fill-amber-400 text-amber-500" />
          ) : (
            <Moon className="h-5 w-5 fill-indigo-200 text-indigo-500" />
          )}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('settings')} onClick={onOpenSettings}>
          <Settings className="h-5 w-5 text-slate-500" />
        </Button>
      </div>
    </header>
  )
}
