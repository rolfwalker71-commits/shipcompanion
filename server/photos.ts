import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readJsonSync, writeJson } from './persist.ts'

const DIR = 'data/photos'
const FILE = `${DIR}/latest.jpg`
const META = 'photos.json'
const MAX_BYTES = 4 * 1024 * 1024

export type PhotoMeta = {
  at: string
  bytes: number
} | null

type Store = { at: string; bytes: number } | null

export function photoMeta(): PhotoMeta {
  const store = readJsonSync<Store>(META, null)
  if (!store || !existsSync(FILE)) return null
  return store
}

export async function readPhoto(): Promise<Buffer | null> {
  if (!photoMeta()) return null
  try {
    return await readFile(FILE)
  } catch {
    return null
  }
}

export async function savePhoto(bytes: Buffer): Promise<PhotoMeta> {
  if (bytes.length < 32 || bytes.length > MAX_BYTES) return null
  await mkdir(DIR, { recursive: true })
  await writeFile(FILE, bytes)
  const meta = { at: new Date().toISOString(), bytes: bytes.length }
  await writeJson(META, meta)
  return meta
}

export async function clearPhoto(): Promise<void> {
  await writeJson(META, null)
}
