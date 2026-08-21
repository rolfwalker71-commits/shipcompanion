import { History, Moon, Settings, Ship, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from '@/lib/theme'

type AppHeaderProps = {
  ships?: { id: string; name: string }[]
  selectedId?: string | null
  onSelectShip?: (id: string) => void
  onOpenSettings: () => void
  onOpenTimeline: () => void
}

export function AppHeader({
  ships = [],
  selectedId = null,
  onSelectShip,
  onOpenSettings,
  onOpenTimeline,
}: AppHeaderProps) {
  const { t, i18n } = useTranslation()
  const { resolved, setTheme } = useTheme()
  const nextLang = i18n.language.startsWith('de') ? 'en' : 'de'
  const selectedName = ships.find((ship) => ship.id === selectedId)?.name

  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-card/90 pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur-md sm:pr-6 sm:pl-6">
      <div className="flex min-h-14 min-w-0 items-center gap-2 sm:gap-3">
        <Ship className="h-5 w-5 shrink-0 fill-sky-100 text-sky-700 sm:h-6 sm:w-6" aria-hidden />
        {ships.length > 1 && selectedId && onSelectShip ? (
          <Select value={selectedId} onValueChange={onSelectShip}>
            <SelectTrigger
              aria-label={t('ship')}
              className="h-9 min-h-9 w-auto max-w-[11rem] border-0 bg-transparent px-2 text-base font-semibold tracking-tight shadow-none sm:max-w-[16rem] sm:text-lg"
            >
              <SelectValue>{selectedName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ships.map((ship) => (
                <SelectItem key={ship.id} value={ship.id}>
                  {ship.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <h1 className="break-words text-base font-semibold leading-tight tracking-tight sm:text-xl">
            {selectedName || t('appName')}
          </h1>
        )}
        {import.meta.env.DEV ? (
          <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
            DEV
          </span>
        ) : null}
      </div>
      <div className="flex min-h-14 shrink-0 items-center gap-1.5 sm:gap-2">
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
        <Button variant="ghost" size="icon" aria-label={t('timeline')} onClick={onOpenTimeline}>
          <History className="h-5 w-5 text-slate-500" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('settings')} onClick={onOpenSettings}>
          <Settings className="h-5 w-5 text-slate-500" />
        </Button>
      </div>
    </header>
  )
}
