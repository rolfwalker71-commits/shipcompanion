import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readJsonSync, writeJson } from './persist.ts'

const DIR = 'data/photos'
const LEGACY_FILE = `${DIR}/latest.jpg`
const META = 'photos.json'
const MAX_BYTES = 4 * 1024 * 1024
const MAX_CAPTION = 280
const MAX_POSTED_BY = 80
const MAX_PHOTOS = 120

export type PhotoEntry = {
  id: string
  at: string
  bytes: number
  caption: string | null
  postedBy: string | null
}

type LegacyStore = {
  at: string
  bytes: number
  caption?: string | null
  postedBy?: string | null
}

type PhotoStore = { photos: PhotoEntry[] }

function photoPath(id: string): string {
  return `${DIR}/${id}.jpg`
}

function newId(): string {
  return randomBytes(8).toString('hex')
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, maxLen)
  return trimmed || null
}

function readStore(): PhotoStore {
  const raw = readJsonSync<PhotoStore | LegacyStore | null>(META, null)
  if (raw && typeof raw === 'object' && Array.isArray((raw as PhotoStore).photos)) {
    return { photos: (raw as PhotoStore).photos.filter((row) => row?.id && row.at) }
  }
  if (raw && typeof raw === 'object' && 'at' in raw && typeof raw.at === 'string') {
    const legacy = raw as LegacyStore
    return {
      photos: existsSync(LEGACY_FILE)
        ? [
            {
              id: 'legacy',
              at: legacy.at,
              bytes: legacy.bytes,
              caption: legacy.caption ?? null,
              postedBy: legacy.postedBy ?? null,
            },
          ]
        : [],
    }
  }
  return { photos: [] }
}

let migrated = false

async function ensureMigrated(): Promise<PhotoStore> {
  const store = readStore()
  if (migrated) return store
  migrated = true

  const legacy = store.photos.find((photo) => photo.id === 'legacy')
  if (legacy && existsSync(LEGACY_FILE)) {
    await mkdir(DIR, { recursive: true })
    const target = photoPath(legacy.id)
    if (!existsSync(target)) {
      await copyFile(LEGACY_FILE, target)
    }
    try {
      await unlink(LEGACY_FILE)
    } catch {
      /* ignore */
    }
    await writeJson(META, store)
  }

  return store
}

function persist(store: PhotoStore): void {
  void writeJson(META, store)
}

export async function listPhotos(): Promise<PhotoEntry[]> {
  const store = await ensureMigrated()
  return store.photos
    .filter((photo) => existsSync(photoPath(photo.id)))
    .sort((a, b) => a.at.localeCompare(b.at))
}

export async function readPhoto(id: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{16}$/.test(id) && id !== 'legacy') return null
  await ensureMigrated()
  try {
    return await readFile(photoPath(id))
  } catch {
    return null
  }
}

export async function savePhoto(
  bytes: Buffer,
  fields?: { caption?: unknown; postedBy?: unknown },
): Promise<PhotoEntry | null> {
  if (bytes.length < 32 || bytes.length > MAX_BYTES) return null
  await mkdir(DIR, { recursive: true })
  const store = await ensureMigrated()
  const entry: PhotoEntry = {
    id: newId(),
    at: new Date().toISOString(),
    bytes: bytes.length,
    caption: cleanText(fields?.caption, MAX_CAPTION),
    postedBy: cleanText(fields?.postedBy, MAX_POSTED_BY),
  }
  await writeFile(photoPath(entry.id), bytes)
  store.photos.push(entry)
  while (store.photos.length > MAX_PHOTOS) {
    const removed = store.photos.shift()
    if (removed) {
      try {
        await unlink(photoPath(removed.id))
      } catch {
        /* ignore */
      }
    }
  }
  persist(store)
  return entry
}

export async function deletePhoto(id: string): Promise<boolean> {
  if (!/^[a-f0-9]{16}$/.test(id) && id !== 'legacy') return false
  const store = await ensureMigrated()
  const index = store.photos.findIndex((photo) => photo.id === id)
  if (index < 0) return false
  store.photos.splice(index, 1)
  persist(store)
  try {
    await unlink(photoPath(id))
  } catch {
    /* ignore */
  }
  return true
}
