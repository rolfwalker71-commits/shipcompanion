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
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
