import { useRef } from 'react'
import { Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type DateFieldProps = {
  id: string
  value: string
  onChange: (value: string) => void
  locale: 'de' | 'en'
}

export function DateField({ id, value, onChange, locale }: DateFieldProps) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const formatted = formatDisplay(value, locale)

  function openPicker() {
    const el = pickerRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      el.showPicker()
      return
    }
    el.focus()
    el.click()
  }

  return (
    <div className="relative">
      <Input
        id={id}
        readOnly
        value={formatted}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPicker()
          }
        }}
        className="cursor-pointer pr-12"
      />
      <input
        ref={pickerRef}
        type="date"
        value={value}
        lang={locale === 'de' ? 'de-DE' : 'en-GB'}
        onChange={(event) => onChange(event.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0"
        onClick={openPicker}
        aria-label={locale === 'de' ? 'Kalender' : 'Calendar'}
      >
        <Calendar className="h-4 w-4" />
      </Button>
    </div>
  )
}

function formatDisplay(isoDate: string, locale: 'de' | 'en'): string {
  if (!isoDate) return ''
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}
