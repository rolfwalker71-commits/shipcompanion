import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

type Session = {
  token: string
  expiresAt: number
}

const sessions = new Map<string, Session>()
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14
const MAX_ATTEMPTS = 8
const ATTEMPT_WINDOW_MS = 1000 * 60 * 10

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function expectedAccessKey(): string {
  return process.env.APP_ACCESS_KEY?.trim() ?? ''
}

export function keysMatch(provided: string, expected: string): boolean {
  if (!expected) return false
  const a = sha256(provided)
  const b = sha256(expected)
  return timingSafeEqual(a, b)
}

export function allowLoginAttempt(ip: string): boolean {
  const now = Date.now()
  const current = loginAttempts.get(ip)
  if (!current || now > current.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS })
    return true
  }
  current.count += 1
  return current.count <= MAX_ATTEMPTS
}

export function createSession(): string {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { token, expiresAt: Date.now() + SESSION_TTL_MS })
  return token
}

export function sessionIsValid(token: string | undefined): boolean {
  if (!token) return false
  const session = sessions.get(token)
  if (!session) return false
  if (Date.now() > session.expiresAt) {
    sessions.delete(token)
    return false
  }
  return true
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token)
}

export const COOKIE_NAME = 'cruise_session'
