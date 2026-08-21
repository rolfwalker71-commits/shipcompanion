import { useEffect, useMemo, useState } from 'react'
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
import {
  fetchRemoteFleet,
  loadFleet,
  loadSelectedId,
  pickTrip,
  pushRemoteTrip,
  removeRemoteTrip,
  saveFleet,
  saveSelectedId,
  saveTrip,
} from '@/lib/trip'
import { tripKey, tripMmsi, tripShip } from '@shared/ships.ts'
import type { Trip } from '@shared/types.ts'

function isWidgetPath(path: string): boolean {
  return path.replace(/\/$/, '') === '/widget'
}

export default function App() {
  const { t } = useTranslation()
  const { ready, signedIn, isAdmin } = useAuth()
  const [fleet, setFleet] = useState<Trip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tripReady, setTripReady] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupMode, setSetupMode] = useState<'add' | 'edit'>('edit')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [widget, setWidget] = useState(() => isWidgetPath(window.location.pathname))

  const trip = useMemo(() => pickTrip(fleet, selectedId), [fleet, selectedId])
  const setupTrip = useMemo(() => {
    if (setupMode !== 'edit') return null
    if (editingId) return fleet.find((row) => tripKey(row) === editingId) ?? trip
    return trip
  }, [editingId, fleet, setupMode, trip])
  const shipNames = useMemo(
    () =>
      fleet.map((row) => ({
        id: tripKey(row),
        name: tripShip(row)?.name ?? row.shipId,
      })),
    [fleet],
  )

  useEffect(() => {
    if (!signedIn) {
      setTripReady(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const remote = await fetchRemoteFleet()
        if (cancelled) return
        if (remote.length) {
          saveFleet(remote)
          setFleet(remote)
          const stored = loadSelectedId()
          setSelectedId(pickTrip(remote, stored) ? stored ?? tripKey(remote[0]) : tripKey(remote[0]))
        } else {
          const local = loadFleet()
          if (local.length && isAdmin) {
            try {
              const saved = await pushRemoteTrip(local[0])
              if (cancelled) return
              const merged = [saved, ...local.slice(1)]
              saveFleet(merged)
              setFleet(merged)
              setSelectedId(tripKey(saved))
            } catch {
              if (cancelled) return
              setFleet(local)
              setSelectedId(loadSelectedId() ?? tripKey(local[0]))
            }
          } else {
            setFleet(local)
            setSelectedId(local[0] ? loadSelectedId() ?? tripKey(local[0]) : null)
          }
        }
      } catch {
        if (!cancelled) {
          const local = loadFleet()
          setFleet(local)
          setSelectedId(local[0] ? loadSelectedId() ?? tripKey(local[0]) : null)
        }
      } finally {
        if (!cancelled) setTripReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, isAdmin])

  useEffect(() => {
    if (signedIn && isAdmin && tripReady && !fleet.length) {
      setSetupMode('add')
      setSetupOpen(true)
    }
  }, [signedIn, isAdmin, fleet.length, tripReady])

  useEffect(() => {
    const sync = () => setWidget(isWidgetPath(window.location.pathname))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  function selectShip(id: string) {
    setSelectedId(id)
    saveSelectedId(id)
  }

  if (!ready || (signedIn && !tripReady)) {
    return <div className="min-h-dvh bg-background" />
  }

  if (!signedIn) {
    return <LoginScreen />
  }

  const needsSetup = isAdmin && !fleet.length

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
        ships={shipNames}
        selectedId={trip ? tripKey(trip) : null}
        onSelectShip={selectShip}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTimeline={() => setTimelineOpen(true)}
      />
      {widget ? null : <InstallBanner />}
      <TimelineDialog
        open={timelineOpen}
        onOpenChange={setTimelineOpen}
        mmsi={trip ? tripMmsi(trip) : undefined}
      />
      {isAdmin ? (
        <TripSetupDialog
          open={setupOpen || needsSetup}
          trip={setupTrip}
          onOpenChange={(open) => {
            if (fleet.length) setSetupOpen(open)
            if (!open) setEditingId(null)
          }}
          onSave={async (next) => {
            const previousId = setupMode === 'edit' ? (editingId ?? (trip ? tripKey(trip) : null)) : null
            try {
              const saved = await pushRemoteTrip(next)
              const key = tripKey(saved)
              if (previousId && previousId !== key) {
                try {
                  await removeRemoteTrip(previousId)
                } catch {
                  /* old id already gone */
                }
              }
              setFleet((current) => {
                const without = current.filter(
                  (row) =>
                    tripKey(row) !== key &&
                    tripMmsi(row) !== tripMmsi(saved) &&
                    tripKey(row) !== previousId,
                )
                const merged = [...without, saved]
                saveFleet(merged)
                return merged
              })
              selectShip(key)
              setEditingId(null)
            } catch (error) {
              if (!fleet.length) {
                saveTrip(next)
                setFleet([next])
                selectShip(tripKey(next))
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
        ships={fleet}
        selectedId={trip ? tripKey(trip) : null}
        selectedMmsi={trip ? tripMmsi(trip) : ''}
        onSelectShip={selectShip}
        onAddShip={() => {
          setEditingId(null)
          setSetupMode('add')
          setSetupOpen(true)
        }}
        onEditShip={(id) => {
          setSelectedId(id)
          saveSelectedId(id)
          setEditingId(id)
          setSetupMode('edit')
          setSetupOpen(true)
        }}
        onRemoveShip={async (id) => {
          const next = await removeRemoteTrip(id)
          setFleet(next)
          const remaining = pickTrip(next, selectedId === id ? null : selectedId)
          selectShip(remaining ? tripKey(remaining) : '')
        }}
      />
    </div>
  )
}
