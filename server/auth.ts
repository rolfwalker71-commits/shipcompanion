import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readJsonSync, writeJson } from './persist.ts'

export type SessionRole = 'viewer' | 'admin'

type Session = {
  token: string
  expiresAt: number
  role: SessionRole
}

const sessions = new Map<string, Session>()
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14
const MAX_ATTEMPTS = 8
const ATTEMPT_WINDOW_MS = 1000 * 60 * 10

for (const row of readJsonSync<Session[]>('sessions.json', [])) {
  if (row?.token && row.expiresAt > Date.now()) {
    sessions.set(row.token, {
      token: row.token,
      expiresAt: row.expiresAt,
      role: row.role === 'admin' ? 'admin' : 'viewer',
    })
  }
}

function persistSessions(): void {
  const rows = [...sessions.values()].filter((session) => session.expiresAt > Date.now())
  void writeJson('sessions.json', rows)
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function expectedAccessKey(): string {
  return process.env.APP_ACCESS_KEY?.trim() ?? ''
}

export function expectedSettingsPin(): string {
  return process.env.SETTINGS_PIN?.trim() ?? ''
}

export function loginRole(provided: string): SessionRole | null {
  const family = expectedAccessKey()
  const settings = expectedSettingsPin()
  const adminOk = Boolean(settings) && keysMatch(provided, settings)
  if (adminOk) return 'admin'
  if (family && keysMatch(provided, family)) return settings ? 'viewer' : 'admin'
  return null
}

export function keysMatch(provided: string, expected: string): boolean {
  const want = expected.trim()
  if (!want) return false
  const a = sha256(provided.trim())
  const b = sha256(want)
  return timingSafeEqual(a, b)
}

export function allowLoginAttempt(ip: string): boolean {
  const now = Date.now()
  const current = loginAttempts.get(ip)
  if (!current || now > current.resetAt) return true
  return current.count < MAX_ATTEMPTS
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now()
  const current = loginAttempts.get(ip)
  if (!current || now > current.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS })
    return
  }
  current.count += 1
}

export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip)
}

export function createSession(role: SessionRole = 'viewer'): string {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { token, role, expiresAt: Date.now() + SESSION_TTL_MS })
  persistSessions()
  return token
}

export function sessionIsValid(token: string | undefined): boolean {
  return sessionRole(token) != null
}

export function sessionRole(token: string | undefined): SessionRole | null {
  if (!token) return null
  const session = sessions.get(token)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    sessions.delete(token)
    persistSessions()
    return null
  }
  return session.role
}

export function destroySession(token: string | undefined): void {
  if (token) {
    sessions.delete(token)
    persistSessions()
  }
}

export const COOKIE_NAME = 'cruise_session'
