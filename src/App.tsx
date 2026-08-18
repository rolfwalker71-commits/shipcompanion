import { useEffect, useState } from 'react'
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
  const { ready, signedIn } = useAuth()
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
          if (local) {
            await pushRemoteTrip(local)
            if (cancelled) return
            setTrip(local)
          } else {
            setTrip(null)
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
  }, [signedIn])

  useEffect(() => {
    if (signedIn && tripReady && !trip) setSetupOpen(true)
  }, [signedIn, trip, tripReady])

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

  const needsSetup = signedIn && !trip

  return (
    <div className="relative h-dvh overflow-hidden bg-muted">
      {trip ? widget ? <WidgetView trip={trip} /> : <HomeView trip={trip} /> : null}
      <AppHeader
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTimeline={() => setTimelineOpen(true)}
      />
      {widget ? null : <InstallBanner />}
      <TimelineDialog open={timelineOpen} onOpenChange={setTimelineOpen} />
      <TripSetupDialog
        open={setupOpen || needsSetup}
        trip={trip}
        onOpenChange={(open) => {
          if (trip) setSetupOpen(open)
        }}
        onSave={async (next, pin) => {
          try {
            await pushRemoteTrip(next, pin)
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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onEditTrip={() => setSetupOpen(true)}
      />
    </div>
  )
}
