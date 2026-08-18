import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppHeader } from '@/components/layout/AppHeader'
import { InstallBanner } from '@/components/layout/InstallBanner'
import { HomeView } from '@/components/home/HomeView'
import { WidgetView } from '@/components/home/WidgetView'
import { TimelineDialog } from '@/components/home/TimelineDialog'
import { LoginScreen } from '@/components/LoginScreen'
import { TripSetupDialog } from '@/components/onboarding/TripSetupDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useAuth } from '@/lib/auth'
import { fetchRemoteTrip, loadTrip, pushRemoteTrip, saveTrip } from '@/lib/trip'
import type { Trip } from '@shared/types.ts'

function isWidgetPath(path: string): boolean {
  return path.replace(/\/$/, '') === '/widget'
}

export default function App() {
  const { t } = useTranslation()
  const { ready, signedIn, isAdmin } = useAuth()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [tripReady, setTripReady] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [widget, setWidget] = useState(() => isWidgetPath(window.location.pathname))

  useEffect(() => {
    if (!signedIn) {
      setTripReady(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const remote = await fetchRemoteTrip()
        if (cancelled) return
        if (remote) {
          saveTrip(remote)
          setTrip(remote)
        } else {
          const local = loadTrip()
          if (local && isAdmin) {
            try {
              await pushRemoteTrip(local)
            } catch {
              /* show local trip until the server accepts it */
            }
            if (cancelled) return
            setTrip(local)
          } else {
            setTrip(local)
          }
        }
      } catch {
        if (!cancelled) setTrip(loadTrip())
      } finally {
        if (!cancelled) setTripReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, isAdmin])

  useEffect(() => {
    if (signedIn && isAdmin && tripReady && !trip) setSetupOpen(true)
  }, [signedIn, isAdmin, trip, tripReady])

  useEffect(() => {
    const sync = () => setWidget(isWidgetPath(window.location.pathname))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  if (!ready || (signedIn && !tripReady)) {
    return <div className="min-h-dvh bg-background" />
  }

  if (!signedIn) {
    return <LoginScreen />
  }

  const needsSetup = isAdmin && !trip

  return (
    <div className="relative h-dvh overflow-hidden bg-muted">
      {trip ? (
        widget ? <WidgetView trip={trip} /> : <HomeView trip={trip} />
      ) : (
        <div className="flex h-full items-center justify-center px-6">
          <p className="text-center text-base text-muted-foreground">{t('tripNotReady')}</p>
        </div>
      )}
      <AppHeader
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTimeline={() => setTimelineOpen(true)}
      />
      {widget ? null : <InstallBanner />}
      <TimelineDialog open={timelineOpen} onOpenChange={setTimelineOpen} />
      {isAdmin ? (
        <TripSetupDialog
          open={setupOpen || needsSetup}
          trip={trip}
          onOpenChange={(open) => {
            if (trip) setSetupOpen(open)
          }}
          onSave={async (next) => {
            try {
              await pushRemoteTrip(next)
              setTrip(next)
            } catch (error) {
              if (!trip) {
                saveTrip(next)
                setTrip(next)
                return
              }
              throw error
            }
          }}
        />
      ) : null}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onEditTrip={() => setSetupOpen(true)}
      />
    </div>
  )
}
