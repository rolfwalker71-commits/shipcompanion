import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type PhotoMeta = { at: string } | null

export function BoardPhoto() {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [meta, setMeta] = useState<PhotoMeta>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/photos', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { photo?: { at: string } | null } | null) => {
        if (!cancelled) setMeta(data?.photo ?? null)
      })
      .catch(() => {
        if (!cancelled) setMeta(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onFile(file: File | undefined) {
    if (!file || busy) return
    setBusy(true)
    try {
      const blob = await compressPhoto(file)
      const body = new FormData()
      body.append('photo', blob, 'board.jpg')
      const res = await fetch('/api/photos', { method: 'POST', credentials: 'include', body })
      if (!res.ok) return
      const data = (await res.json()) as { photo?: { at: string } }
      setMeta(data.photo ?? { at: new Date().toISOString() })
    } finally {
      setBusy(false)
    }
  }

  const src = meta ? `/api/photos/latest?at=${encodeURIComponent(meta.at)}` : null

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
      {src ? (
        <Button
          variant="ghost"
          className="size-14 min-h-11 shrink-0 overflow-hidden rounded-2xl p-0"
          aria-label={t('photoOpen')}
          onClick={() => setOpen(true)}
        >
          <img src={src} alt="" className="size-full object-cover" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className="size-14 shrink-0 rounded-2xl"
          aria-label={t('photoAdd')}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? <Camera className="h-5 w-5 animate-pulse" /> : <ImagePlus className="h-5 w-5" />}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{t('photoTitle')}</DialogTitle>
            <DialogDescription>{t('photoHint')}</DialogDescription>
          </DialogHeader>
          {src ? (
            <img src={src} alt="" className="mt-3 max-h-[60dvh] w-full rounded-2xl object-contain" />
          ) : null}
          <Button
            variant="secondary"
            className="mt-4 w-full"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Camera className="h-4 w-4" />
            {t('photoReplace')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
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
