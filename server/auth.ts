import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readJsonSync, writeJson } from './persist.ts'

type Session = {
  token: string
  expiresAt: number
}

const sessions = new Map<string, Session>()
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14
const MAX_ATTEMPTS = 8
const ATTEMPT_WINDOW_MS = 1000 * 60 * 10

for (const row of readJsonSync<Session[]>('sessions.json', [])) {
  if (row?.token && row.expiresAt > Date.now()) sessions.set(row.token, row)
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

export function createSession(): string {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { token, expiresAt: Date.now() + SESSION_TTL_MS })
  persistSessions()
  return token
}

export function sessionIsValid(token: string | undefined): boolean {
  if (!token) return false
  const session = sessions.get(token)
  if (!session) return false
  if (Date.now() > session.expiresAt) {
    sessions.delete(token)
    persistSessions()
    return false
  }
  return true
}

export function destroySession(token: string | undefined): void {
  if (token) {
    sessions.delete(token)
    persistSessions()
  }
}

export const COOKIE_NAME = 'cruise_session'
