import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type AuthContextValue = {
  ready: boolean
  signedIn: boolean
  login: (key: string) => Promise<'ok' | 'invalid' | 'busy' | 'error'>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    void fetch('/api/auth/session', { credentials: 'include' })
      .then((res) => setSignedIn(res.ok))
      .catch(() => setSignedIn(false))
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (key: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    if (res.status === 429) return 'busy'
    if (res.status === 401) return 'invalid'
    if (!res.ok) return 'error'
    setSignedIn(true)
    return 'ok'
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setSignedIn(false)
  }, [])

  const value = useMemo(
    () => ({ ready, signedIn, login, logout }),
    [ready, signedIn, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
