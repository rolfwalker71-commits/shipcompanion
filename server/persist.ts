import { mkdir, rename, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'

const DIR = 'data'

export function readJsonSync<T>(file: string, fallback: T): T {
  const path = `${DIR}/${file}`
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(DIR, { recursive: true })
  const path = `${DIR}/${file}`
  const tmp = `${path}.tmp`
  const payload = `${JSON.stringify(value, null, 2)}\n`
  try {
    await writeFile(tmp, payload, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    // Some bind mounts briefly lose the temp file during atomic rename.
    // Fall back to writing the final file directly instead of crashing.
    try {
      await mkdir(DIR, { recursive: true })
      await writeFile(path, payload, 'utf8')
    } catch (fallbackError) {
      console.warn(
        'persist write failed:',
        fallbackError instanceof Error ? fallbackError.message : fallbackError,
        'after',
        error instanceof Error ? error.message : error,
      )
    }
  }
}
