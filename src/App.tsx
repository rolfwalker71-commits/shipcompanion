import { useEffect, useState } from 'react'
import { AppHeader } from '@/components/layout/AppHeader'
import { InstallBanner } from '@/components/layout/InstallBanner'
import { HomeView } from '@/components/home/HomeView'
import { LoginScreen } from '@/components/LoginScreen'
import { TripSetupDialog } from '@/components/onboarding/TripSetupDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useAuth } from '@/lib/auth'
import { fetchRemoteTrip, loadTrip, pushRemoteTrip, saveTrip } from '@/lib/trip'
import type { Trip } from '@shared/types.ts'

export default function App() {
  const { ready, signedIn } = useAuth()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [tripReady, setTripReady] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  if (!ready || (signedIn && !tripReady)) {
    return <div className="min-h-dvh bg-background" />
  }

  if (!signedIn) {
    return <LoginScreen />
  }

  const needsSetup = signedIn && !trip

  return (
    <div className="relative h-dvh overflow-hidden bg-muted">
      {trip ? <HomeView trip={trip} /> : null}
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} />
      <InstallBanner />
      <TripSetupDialog
        open={setupOpen || needsSetup}
        trip={trip}
        onOpenChange={(open) => {
          if (trip) setSetupOpen(open)
        }}
        onSave={(next) => {
          void pushRemoteTrip(next)
            .then(() => {
              setTrip(next)
              setSetupOpen(false)
            })
            .catch(() => {
              saveTrip(next)
              setTrip(next)
              setSetupOpen(false)
            })
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
