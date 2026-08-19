import { useCallback, useEffect, useState } from 'react'
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

const POSTER_STORAGE_KEY = 'board-photo-poster'
const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
}

type Preview = {
  lat: number
  lng: number
  accuracyM: number | null
}

type ManualPositionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted?: () => void
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
      return
    }
    try {
      setPostedBy(localStorage.getItem(POSTER_STORAGE_KEY) ?? '')
    } catch {
      setPostedBy('')
    }
    locate()
  }, [open, locate])

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
        if (res.status === 403) {
          setSubmitError('forbidden')
          return
        }
        if (res.status === 429) {
          setSubmitError('too_soon')
          return
        }
        if (!res.ok) {
          setSubmitError('bad')
          return
        }
        if (postedBy.trim()) {
          try {
            localStorage.setItem(POSTER_STORAGE_KEY, postedBy.trim())
          } catch {
            /* ignore */
          }
        }
        setOk(true)
        onSubmitted?.()
      })
      .catch(() => setSubmitError('bad'))
      .finally(() => setBusy(false))
  }

  const coords =
    preview != null
      ? `${preview.lat.toFixed(5)}, ${preview.lng.toFixed(5)}`
      : null
  const accuracy =
    preview?.accuracyM != null ? t('manualPositionAccuracy', { meters: Math.round(preview.accuracyM) }) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manualPositionTitle')}</DialogTitle>
          <DialogDescription>{t('manualPositionHint')}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-4">
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
          <Button
            variant="secondary"
            className="w-full"
            disabled={locating || busy}
            onClick={locate}
          >
            <LocateFixed className="h-4 w-4" aria-hidden />
            {t('manualPositionLocate')}
          </Button>
          <Button className="w-full" disabled={!preview || locating || busy} onClick={submit}>
            {t('manualPositionSubmit')}
          </Button>
          {ok ? (
            <p className="text-sm text-foreground" role="status">
              {t('manualPositionOk')}
            </p>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
