import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('cruise-theme')
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  })
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(theme))

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(theme)
      setResolved(next)
      document.documentElement.classList.toggle('dark', next === 'dark')
      const color = next === 'dark' ? '#1C2433' : '#F7F3EB'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
    }
    apply()
    localStorage.setItem('cruise-theme', theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
