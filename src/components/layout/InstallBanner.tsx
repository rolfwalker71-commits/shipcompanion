import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
}

export function InstallBanner() {
  const { t } = useTranslation()
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (incoming: Event) => {
      incoming.preventDefault()
      setEvent(incoming as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (!event) return null

  return (
    <div className="absolute right-4 bottom-6 z-20 sm:right-6">
      <Button
        variant="secondary"
        className="shadow-lg"
        onClick={() => void event.prompt().then(() => setEvent(null))}
      >
        <Download className="h-4 w-4" />
        {t('install')}
      </Button>
    </div>
  )
}
