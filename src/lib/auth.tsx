import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type SessionRole = 'viewer' | 'admin'

type AuthContextValue = {
  ready: boolean
  signedIn: boolean
  role: SessionRole | null
  isAdmin: boolean
  login: (key: string) => Promise<'ok' | 'invalid' | 'busy' | 'session' | 'error'>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readRole(data: unknown): SessionRole | null {
  const role = (data as { role?: unknown } | null)?.role
  return role === 'admin' || role === 'viewer' ? role : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [role, setRole] = useState<SessionRole | null>(null)

  useEffect(() => {
    void fetch('/api/auth/session', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          setSignedIn(false)
          setRole(null)
          return
        }
        const data: unknown = await res.json().catch(() => null)
        setSignedIn(true)
        setRole(readRole(data) ?? 'viewer')
      })
      .catch(() => {
        setSignedIn(false)
        setRole(null)
      })
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (key: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      if (res.status === 429) return 'busy'
      if (res.status === 401) return 'invalid'
      if (!res.ok) return 'error'
      const session = await fetch('/api/auth/session', { credentials: 'include' })
      if (!session.ok) return 'session'
      const data: unknown = await session.json().catch(() => null)
      setRole(readRole(data) ?? 'viewer')
      setSignedIn(true)
      return 'ok'
    } catch {
      return 'error'
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setSignedIn(false)
    setRole(null)
  }, [])

  const value = useMemo(
    () => ({ ready, signedIn, role, isAdmin: role === 'admin', login, logout }),
    [ready, signedIn, role, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
