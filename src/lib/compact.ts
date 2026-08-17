import { useEffect, useState } from 'react'

export function useCompactUi(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(max-width: 639px)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const sync = () => setCompact(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  return compact
}
