import { Moon, Settings, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

type AppHeaderProps = {
  onOpenSettings: () => void
}

export function AppHeader({ onOpenSettings }: AppHeaderProps) {
  const { t, i18n } = useTranslation()
  const { resolved, setTheme } = useTheme()
  const nextLang = i18n.language.startsWith('de') ? 'en' : 'de'

  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-card/90 px-4 py-1.5 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-3">
        <Ship className="h-6 w-6 fill-sky-100 text-sky-700" aria-hidden />
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{t('appName')}</h1>
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
        <div className="flex items-center rounded-full bg-muted p-1" role="group" aria-label={t('theme')}>
          <Button
            variant="ghost"
            size="icon"
            className={cn('rounded-full', resolved === 'light' && 'bg-background shadow-sm')}
            aria-label={t('themeLight')}
            aria-pressed={resolved === 'light'}
            onClick={() => setTheme('light')}
          >
            <Sun className="h-5 w-5 fill-amber-400 text-amber-500" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('rounded-full', resolved === 'dark' && 'bg-background shadow-sm')}
            aria-label={t('themeDark')}
            aria-pressed={resolved === 'dark'}
            onClick={() => setTheme('dark')}
          >
            <Moon className="h-5 w-5 fill-indigo-200 text-indigo-500" />
          </Button>
        </div>
        <Button variant="ghost" size="icon" aria-label={t('settings')} onClick={onOpenSettings}>
          <Settings className="h-5 w-5 text-slate-500" />
        </Button>
      </div>
    </header>
  )
}
