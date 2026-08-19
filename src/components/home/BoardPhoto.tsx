import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Locale } from '@shared/types.ts'
import { formatSeen } from '@shared/time.ts'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
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

type PhotoEntry = {
  id: string
  at: string
  caption: string | null
  postedBy: string | null
}

export function BoardPhoto() {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  const locale = (i18n.language.startsWith('de') ? 'de' : 'en') as Locale
  const input = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [index, setIndex] = useState(0)
  const [postedBy, setPostedBy] = useState('')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const loadPhotos = useCallback(async () => {
    const res = await fetch('/api/photos', { credentials: 'include' })
    if (!res.ok) {
      setPhotos([])
      return []
    }
    const data = (await res.json()) as { photos?: PhotoEntry[] }
    const rows = Array.isArray(data.photos) ? data.photos : []
    setPhotos(rows)
    return rows
  }, [])

  useEffect(() => {
    void loadPhotos().catch(() => setPhotos([]))
  }, [loadPhotos])

  useEffect(() => {
    if (photos.length) return
    const saved = localStorage.getItem(POSTER_STORAGE_KEY)
    if (saved) setPostedBy(saved)
  }, [photos.length])

  const scrollTo = useCallback((next: number, smooth = false) => {
    const el = scroller.current
    if (!el?.clientWidth) return
    const clamped = Math.max(0, Math.min(next, photos.length - 1))
    el.scrollTo({ left: clamped * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
    setIndex(clamped)
  }, [photos.length])

  useEffect(() => {
    if (!open || photos.length === 0) return
    const target = photos.length - 1
    setIndex(target)
    requestAnimationFrame(() => scrollTo(target))
  }, [open, photos.length, scrollTo])

  const current = photos[index] ?? null
  const newest = photos.at(-1) ?? null
  const thumbSrc = newest ? photoSrc(newest) : null

  function openDialog() {
    setOpen(true)
  }

  async function onFile(file: File | undefined) {
    if (!file || busy) return
    setBusy(true)
    try {
      const blob = await compressPhoto(file)
      const body = new FormData()
      body.append('photo', blob, 'board.jpg')
      if (postedBy.trim()) body.append('postedBy', postedBy.trim())
      if (caption.trim()) body.append('caption', caption.trim())
      const res = await fetch('/api/photos', { method: 'POST', credentials: 'include', body })
      if (!res.ok) return
      const rows = await loadPhotos()
      setCaption('')
      if (postedBy.trim()) localStorage.setItem(POSTER_STORAGE_KEY, postedBy.trim())
      const nextIndex = Math.max(0, rows.length - 1)
      requestAnimationFrame(() => scrollTo(nextIndex, true))
    } finally {
      setBusy(false)
    }
  }

  async function deleteCurrent() {
    if (!isAdmin || busy || !current) return
    if (!window.confirm(t('photoDeleteConfirm'))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/photos/${encodeURIComponent(current.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) return
      const rows = await loadPhotos()
      if (!rows.length) {
        setOpen(false)
        return
      }
      const nextIndex = Math.min(index, rows.length - 1)
      requestAnimationFrame(() => scrollTo(nextIndex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void onFile(file)
        }}
      />
      {thumbSrc ? (
        <Button
          variant="ghost"
          className="relative size-14 min-h-11 shrink-0 overflow-hidden rounded-2xl p-0"
          aria-label={t('photoOpen')}
          onClick={openDialog}
        >
          <img src={thumbSrc} alt="" className="size-full object-cover" />
          {photos.length > 1 ? (
            <span className="absolute right-1 bottom-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground shadow-sm">
              {photos.length}
            </span>
          ) : null}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className="size-14 shrink-0 rounded-2xl"
          aria-label={t('photoAdd')}
          disabled={busy}
          onClick={openDialog}
        >
          {busy ? <Camera className="h-5 w-5 animate-pulse" /> : <ImagePlus className="h-5 w-5" />}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{t('photoTitle')}</DialogTitle>
            <DialogDescription>
              {photos.length > 1 ? t('photoSwipe') : t('photoHint')}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 space-y-4">
            {photos.length > 0 ? (
              <>
                <div
                  ref={scroller}
                  className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
                  aria-label={t('photoSwipe')}
                  onScroll={(event) => {
                    const el = event.currentTarget
                    if (!el.clientWidth) return
                    setIndex(Math.round(el.scrollLeft / el.clientWidth))
                  }}
                >
                  {photos.map((photo) => (
                    <section
                      key={photo.id}
                      className="w-full shrink-0 snap-start basis-full space-y-3 pr-1"
                      aria-label={formatSeen(photo.at, locale, true)}
                    >
                      <img
                        src={photoSrc(photo)}
                        alt=""
                        className="max-h-[40dvh] w-full rounded-2xl object-contain"
                      />
                      <p className="text-sm text-muted-foreground">
                        {t('photoPostedAt')}{' '}
                        <time dateTime={photo.at} className="font-medium tabular-nums text-foreground">
                          {formatSeen(photo.at, locale, true)}
                        </time>
                      </p>
                      {photo.postedBy ? (
                        <p className="text-sm text-muted-foreground">
                          {t('photoPostedBy')}{' '}
                          <span className="font-medium text-foreground">{photo.postedBy}</span>
                        </p>
                      ) : null}
                      {photo.caption ? (
                        <p className="break-words text-sm leading-snug text-foreground">{photo.caption}</p>
                      ) : null}
                    </section>
                  ))}
                </div>
                {photos.length > 1 ? (
                  <p className="text-center text-xs text-muted-foreground" aria-live="polite">
                    {t('photoCount', { current: index + 1, total: photos.length })}
                  </p>
                ) : null}
                {isAdmin && current ? (
                  <Button variant="destructive" className="w-full" disabled={busy} onClick={() => void deleteCurrent()}>
                    <Trash2 className="h-4 w-4" />
                    {t('photoDelete')}
                  </Button>
                ) : null}
              </>
            ) : null}
            {isAdmin && (
              <div className="space-y-3 border-t border-border/60 pt-4">
                <p className="text-sm font-medium text-foreground">
                  {photos.length ? t('photoAddAnother') : t('photoAdd')}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="board-photo-poster">{t('photoPostedBy')}</Label>
                  <Input
                    id="board-photo-poster"
                    value={postedBy}
                    placeholder={t('photoPostedByPlaceholder')}
                    autoComplete="name"
                    onChange={(event) => setPostedBy(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="board-photo-caption">{t('photoCaption')}</Label>
                  <textarea
                    id="board-photo-caption"
                    value={caption}
                    rows={3}
                    placeholder={t('photoCaptionPlaceholder')}
                    className={cn(
                      'flex min-h-11 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring md:text-sm',
                    )}
                    onChange={(event) => setCaption(event.target.value)}
                  />
                </div>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  <Camera className="h-4 w-4" />
                  {photos.length ? t('photoAddAnother') : t('photoAdd')}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function photoSrc(photo: PhotoEntry): string {
  return `/api/photos/${encodeURIComponent(photo.id)}?at=${encodeURIComponent(photo.at)}`
}

async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const max = 1280
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    return blob ?? file
  } catch {
    return file
  }
}
