import { useCallback, useState } from 'react'

export type MapStyle = 'voyager' | 'satellite'

const STORAGE_KEY = 'cruise-map-style'

function readStored(): MapStyle {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'satellite' ? 'satellite' : 'voyager'
  } catch {
    return 'voyager'
  }
}

export function useMapStyle() {
  const [style, setStyleState] = useState<MapStyle>(readStored)

  const setStyle = useCallback((next: MapStyle) => {
    setStyleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private mode */
    }
  }, [])

  return { style, setStyle }
}
