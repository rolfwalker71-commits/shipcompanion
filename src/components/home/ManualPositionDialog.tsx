import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { LocateFixed, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMapStyle } from '@/lib/map-style'
import { cn } from '@/lib/utils'

const POSTER_STORAGE_KEY = 'board-photo-poster'
const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
}
const VOYAGER_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

type Preview = {
  lat: number
  lng: number
  accuracyM: number | null
}

type RoutePoint = {
  lat: number
  lng: number
  ts: number
  accuracyM: number | null
  postedBy: string | null
}

type ArchiveMeta = {
  id: string
  name: string | null
  createdAt: number
  pointCount: number
  startAt: number | null
  endAt: number | null
}

type ManualPositionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted?: () => void
}

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="white"/></svg>`

function previewIcon() {
  return L.divIcon({
    className: 'cruise-div-icon',
    html: `<div style="color:oklch(0.52 0.1 195);width:24px;height:24px">${PIN_SVG}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
  })
}

function routePointIcon() {
  return L.divIcon({
    className: 'cruise-div-icon',
    html: `<div style="color:oklch(0.58 0.12 70);width:16px;height:16px">${PIN_SVG}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
  })
}

function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap()
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
  const prevKey = useRef('')
  useEffect(() => {
    if (!points.length || key === prevKey.current) return
    prevKey.current = key
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]))
    if (!bounds.isValid()) return
    map.fitBounds(bounds.pad(0.25), { maxZoom: 12, animate: false })
  }, [map, points, key])
  return null
}

function RouteMapInset({
  points,
  preview,
}: {
  points: RoutePoint[]
  preview: Preview | null
}) {
  const { style } = useMapStyle()
  const satellite = style === 'satellite'
  const previewIconMemo = useMemo(() => previewIcon(), [])
  const routeIconMemo = useMemo(() => routePointIcon(), [])

  const allPoints = useMemo(() => {
    const base = points.map((p) => ({ lat: p.lat, lng: p.lng }))
    if (preview) base.push({ lat: preview.lat, lng: preview.lng })
    return base
  }, [points, preview])

  const center: [number, number] = preview
    ? [preview.lat, preview.lng]
    : points.length
      ? [points[0].lat, points[0].lng]
      : [0, 0]

  return (
    <div className="h-48 overflow-hidden rounded-xl border border-border shadow-sm">
      <MapContainer
        center={center}
        zoom={8}
        className="h-full w-full"
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        zoomControl
        attributionControl={false}
      >
        <TileLayer
          key={style}
          url={satellite ? SATELLITE_TILES : VOYAGER_TILES}
          maxZoom={19}
          subdomains={satellite ? '1234' : 'abcd'}
        />
        {points.length > 1 ? (
          <Polyline
            positions={points.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: 'oklch(0.52 0.1 195)', weight: 3, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
          />
        ) : null}
        {points.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lng]} icon={routeIconMemo} />
        ))}
        {preview ? (
          <>
            <Marker position={[preview.lat, preview.lng]} icon={previewIconMemo} />
            {preview.accuracyM != null && preview.accuracyM > 0 ? (
              <Circle
                center={[preview.lat, preview.lng]}
                radius={preview.accuracyM}
                interactive={false}
                pathOptions={{ color: 'oklch(0.52 0.1 195)', weight: 1.5, opacity: 0.7, fillOpacity: 0.1 }}
              />
            ) : null}
          </>
        ) : null}
        <FitBounds points={allPoints} />
      </MapContainer>
    </div>
  )
}

export function ManualPositionDialog({ open, onOpenChange, onSubmitted }: ManualPositionDialogProps) {
  const { t } = useTranslation()
  const [postedBy, setPostedBy] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [geoError, setGeoError] = useState<'denied' | 'timeout' | 'unavailable' | 'unsupported' | null>(null)
  const [submitError, setSubmitError] = useState<'forbidden' | 'too_soon' | 'bad' | null>(null)
  const [ok, setOk] = useState(false)

  const [activeRoute, setActiveRoute] = useState<RoutePoint[]>([])
  const [archives, setArchives] = useState<ArchiveMeta[] | null>(null)
  const [archiveName, setArchiveName] = useState('')
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveMsg, setArchiveMsg] = useState<'ok' | 'error' | 'empty' | null>(null)
  const [selectedArchive, setSelectedArchive] = useState<{ meta: ArchiveMeta; points: RoutePoint[] } | null>(null)

  const loadRoute = useCallback(async () => {
    const res = await fetch('/api/manual-position/route', { credentials: 'include' })
    if (!res.ok) return
    const data = (await res.json()) as { points?: RoutePoint[] }
    setActiveRoute(Array.isArray(data.points) ? data.points : [])
  }, [])

  const loadArchives = useCallback(async () => {
    const res = await fetch('/api/manual-position/archive', { credentials: 'include' })
    if (!res.ok) return
    const data = (await res.json()) as { archives?: ArchiveMeta[] }
    setArchives(Array.isArray(data.archives) ? data.archives : [])
  }, [])

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('unsupported')
      setPreview(null)
      setLocating(false)
      return
    }
    setLocating(true)
    setGeoError(null)
    setSubmitError(null)
    setOk(false)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPreview({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        })
        setLocating(false)
      },
      (error) => {
        setPreview(null)
        setLocating(false)
        if (error.code === error.PERMISSION_DENIED) setGeoError('denied')
        else if (error.code === error.TIMEOUT) setGeoError('timeout')
        else setGeoError('unavailable')
      },
      GEO_OPTIONS,
    )
  }, [])

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setLocating(false)
      setBusy(false)
      setGeoError(null)
      setSubmitError(null)
      setOk(false)
      setArchiveMsg(null)
      setSelectedArchive(null)
      return
    }
    try {
      setPostedBy(localStorage.getItem(POSTER_STORAGE_KEY) ?? '')
    } catch {
      setPostedBy('')
    }
    locate()
    void loadRoute()
    void loadArchives()
  }, [open, locate, loadRoute, loadArchives])

  function geoMessage(): string {
    if (geoError === 'denied') return t('manualPositionDenied')
    if (geoError === 'timeout') return t('manualPositionTimeout')
    return t('manualPositionUnavailable')
  }

  function submit() {
    if (!preview || busy) return
    setBusy(true)
    setSubmitError(null)
    setOk(false)
    void fetch('/api/manual-position', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: preview.lat,
        lng: preview.lng,
        accuracyM: preview.accuracyM,
        postedBy: postedBy.trim() || undefined,
      }),
    })
      .then(async (res) => {
        if (res.status === 403) { setSubmitError('forbidden'); return }
        if (res.status === 429) { setSubmitError('too_soon'); return }
        if (!res.ok) { setSubmitError('bad'); return }
        if (postedBy.trim()) {
          try { localStorage.setItem(POSTER_STORAGE_KEY, postedBy.trim()) } catch { /* ignore */ }
        }
        setOk(true)
        onSubmitted?.()
        void loadRoute()
      })
      .catch(() => setSubmitError('bad'))
      .finally(() => setBusy(false))
  }

  async function saveArchive() {
    setArchiveBusy(true)
    setArchiveMsg(null)
    try {
      const res = await fetch('/api/manual-position/archive', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: archiveName.trim() || undefined }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setArchiveMsg(data?.error === 'empty_route' ? 'empty' : 'error')
        return
      }
      setArchiveMsg('ok')
      setArchiveName('')
      setActiveRoute([])
      void loadArchives()
    } catch {
      setArchiveMsg('error')
    } finally {
      setArchiveBusy(false)
    }
  }

  async function loadArchivePoints(meta: ArchiveMeta) {
    if (selectedArchive?.meta.id === meta.id) {
      setSelectedArchive(null)
      return
    }
    try {
      const res = await fetch(`/api/manual-position/archive/${encodeURIComponent(meta.id)}`, { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as { archive?: { points?: RoutePoint[] } }
      const points = Array.isArray(data.archive?.points) ? (data.archive!.points as RoutePoint[]) : []
      setSelectedArchive({ meta, points })
    } catch { /* ignore */ }
  }

  const coords = preview != null ? `${preview.lat.toFixed(5)}, ${preview.lng.toFixed(5)}` : null
  const accuracy = preview?.accuracyM != null ? t('manualPositionAccuracy', { meters: Math.round(preview.accuracyM) }) : null
  const showMap = activeRoute.length > 0 || preview != null
  const displayPoints = selectedArchive ? selectedArchive.points : activeRoute

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('manualPositionTitle')}</DialogTitle>
          <DialogDescription>{t('manualPositionHint')}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">

          {/* Map inset */}
          {showMap || selectedArchive ? (
            <RouteMapInset
              points={selectedArchive ? selectedArchive.points : displayPoints}
              preview={selectedArchive ? null : preview}
            />
          ) : null}

          {/* GPS preview card */}
          {preview ? (
            <div className="space-y-2 rounded-2xl bg-muted px-4 py-3" role="status">
              <p className="flex items-center gap-2 text-sm font-semibold leading-snug">
                <MapPin className="h-4 w-4 text-teal-600" aria-hidden />
                {t('manualPositionHere')}
              </p>
              <p className="font-medium tabular-nums text-foreground">{coords}</p>
              {accuracy ? <p className="text-sm text-muted-foreground">{accuracy}</p> : null}
            </div>
          ) : locating ? (
            <p className="text-sm leading-relaxed text-muted-foreground" role="status">
              {t('manualPositionLocateBusy')}
            </p>
          ) : geoError ? (
            <p className="text-sm leading-relaxed text-destructive" role="alert">
              {geoMessage()}
            </p>
          ) : null}

          {/* Name field */}
          <div className="space-y-2">
            <Label htmlFor="manual-posted-by">{t('photoPostedBy')}</Label>
            <Input
              id="manual-posted-by"
              value={postedBy}
              onChange={(event) => setPostedBy(event.target.value)}
              placeholder={t('photoPostedByPlaceholder')}
              autoComplete="name"
            />
          </div>

          {/* Actions */}
          <Button variant="secondary" className="w-full" disabled={locating || busy} onClick={locate}>
            <LocateFixed className="h-4 w-4" aria-hidden />
            {t('manualPositionLocate')}
          </Button>
          <Button className="w-full" disabled={!preview || locating || busy} onClick={submit}>
            {t('manualPositionSubmit')}
          </Button>
          {ok ? (
            <p className="text-sm text-foreground" role="status">{t('manualPositionOk')}</p>
          ) : null}
          {submitError ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError === 'forbidden'
                ? t('settingsForbidden')
                : submitError === 'too_soon'
                  ? t('manualPositionRate')
                  : t('tripSaveFailed')}
            </p>
          ) : null}

          {/* Active route summary + archive */}
          <div className="space-y-2 border-t border-border/60 pt-4">
            <p className="text-sm font-medium text-foreground">{t('manualRouteTitle')}</p>
            {activeRoute.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('manualRouteEmpty')}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('manualArchivePoints', { count: activeRoute.length })}
              </p>
            )}
            {activeRoute.length > 0 ? (
              <>
                <Label htmlFor="archive-name">{t('manualRouteNamePlaceholder')}</Label>
                <Input
                  id="archive-name"
                  value={archiveName}
                  onChange={(e) => setArchiveName(e.target.value)}
                  placeholder={t('manualRouteNamePlaceholder')}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={archiveBusy}
                  onClick={() => void saveArchive()}
                >
                  {t('manualRouteSave')}
                </Button>
                {archiveMsg === 'ok' ? (
                  <p className="text-sm text-foreground" role="status">{t('manualRouteSaved')}</p>
                ) : archiveMsg === 'empty' ? (
                  <p className="text-sm text-muted-foreground" role="status">{t('manualRouteEmpty')}</p>
                ) : archiveMsg === 'error' ? (
                  <p className="text-sm text-destructive" role="alert">{t('manualRouteSaveError')}</p>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Archive list */}
          {archives != null && archives.length > 0 ? (
            <div className="space-y-2 border-t border-border/60 pt-4">
              <p className="text-sm font-medium text-foreground">{t('manualArchiveTitle')}</p>
              <ol className="flex flex-col gap-2">
                {archives.map((arc) => {
                  const isSelected = selectedArchive?.meta.id === arc.id
                  return (
                    <li key={arc.id}>
                      <button
                        type="button"
                        className={cn(
                          'w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border bg-background text-foreground hover:bg-muted',
                        )}
                        onClick={() => void loadArchivePoints(arc)}
                      >
                        <p className="font-medium leading-snug">
                          {arc.name ?? new Date(arc.createdAt).toLocaleDateString()}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('manualArchivePoints', { count: arc.pointCount })}
                          {arc.startAt
                            ? ` · ${new Date(arc.startAt).toLocaleDateString()} – ${arc.endAt ? new Date(arc.endAt).toLocaleDateString() : '?'}`
                            : ''}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          ) : archives != null && archives.length === 0 ? null : null}

        </div>
      </DialogContent>
    </Dialog>
  )
}
