import { allHarbors, findHarbor, matchHarbor } from '../shared/harbors.ts'
import {
  parseItineraryPaste,
  type ParseItineraryResult,
  type ParsedItineraryStop,
} from '../shared/itinerary-parse.ts'

const MAX_PASTE = 12_000
const MAX_IMAGE_CHARS = 8_000_000
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type ItineraryImage = {
  mime: string
  data: string
}

type LlmStop = {
  harborId?: unknown
  name?: unknown
  arriveDate?: unknown
  arriveTime?: unknown
  departDate?: unknown
  departTime?: unknown
}

type LlmPayload = {
  stops?: unknown
  skippedSea?: unknown
  unmatched?: unknown
}

export function readItineraryImage(raw: unknown): ItineraryImage | null {
  if (!raw || typeof raw !== 'object') return null
  const mime = 'mime' in raw && typeof raw.mime === 'string' ? raw.mime.trim().toLowerCase() : ''
  let data = 'data' in raw && typeof raw.data === 'string' ? raw.data.trim() : ''
  const embedded = data.match(/^data:([^;]+);base64,(.+)$/i)
  if (embedded) {
    data = embedded[2] ?? ''
    if (!mime && embedded[1]) return readItineraryImage({ mime: embedded[1], data })
  }
  if (!ALLOWED_IMAGE.has(mime) || !data || data.length > MAX_IMAGE_CHARS) return null
  return { mime, data }
}

export async function importItinerary(
  text: string,
  yearHint?: string,
  image?: ItineraryImage | null,
): Promise<ParseItineraryResult> {
  const paste = text.slice(0, MAX_PASTE)
  const local = paste.trim() ? parseItineraryPaste(paste, yearHint) : emptyResult()
  const fromLlm = await llmItinerary(paste, yearHint, image).catch(() => null)
  if (fromLlm?.stops.length) return { ...fromLlm, source: 'llm' }
  return { ...local, source: 'local' }
}

async function llmItinerary(
  text: string,
  yearHint?: string,
  image?: ItineraryImage | null,
): Promise<ParseItineraryResult | null> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return null
  if (!text.trim() && !image) return null
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const catalog = allHarbors()
    .map((harbor) => `${harbor.id} | ${harbor.name} | ${harbor.aliases.join(', ')}`)
    .join('\n')
  const year = yearHint || String(new Date().getFullYear())
  const userText = image
    ? `yearHint: ${year}
catalog:
${catalog}

This is a screenshot of a cruise itinerary table (often headed Kreuzfahrtverlauf). Read every visible row. If extra text was also pasted, use it only to confirm what you see:
${text.trim() || '(no extra text)'}`
    : `yearHint: ${year}
catalog:
${catalog}

text:
${text}`

  const userContent = image
    ? [
        { type: 'text', text: userText },
        {
          type: 'image_url',
          image_url: {
            url: `data:${image.mime};base64,${image.data}`,
            detail: 'high',
          },
        },
      ]
    : userText

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(image ? 35_000 : 20_000),
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: image ? visionPrompt() : textPrompt(),
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
  })

  if (!response.ok) return null
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) return null
  return bindLlmPayload(parseJson(content))
}

function textPrompt(): string {
  return `${sharedRules()}
The input is messy copied text from a booking PDF. Columns are often split: dates in one block, port names in another, then arrivals, then departures, plus junk (guests, flights, legal text, Ortszeit, Arrangements).
${jsonExample()}`
}

function visionPrompt(): string {
  return `${sharedRules()}
The input is a screenshot of an itinerary table (Royal Caribbean Kreuzfahrtverlauf, Costa, or similar). Read it visually as a table.
Typical columns: date (DD MMM — English months even on German tickets), port or CRUISING, arrival, departure. Times are often right-aligned.
Empty arrival on embarkation, empty departure on the last day, no times on sea days. OCR may show CRUISNG or 18:0.
Ignore guest names, flights, legal footnotes, Ortszeit, and anything below the table.
Do not invent ports or times you cannot see.
${jsonExample()}`
}

function sharedRules(): string {
  return `Extract cruise ports from a booking itinerary.
Rules:
- Skip sea days (CRUISING, CRUISNG, AT SEA, AUF SEE) and flights / post-cruise text.
- Times are published local harbor time, 24-hour HH:MM. Fix truncated times such as 18:0 → 18:00.
- Embarkation day: departure only (arriveTime null). Final day: arrival only (departTime null).
- Year comes from yearHint. If months wrap (Dec→Jan), increment the year.
- harborId must be an id from the catalog when the port is clearly the same (Seville/Cadiz → cadiz). Otherwise harborId null and keep the printed name.`
}

function jsonExample(): string {
  return `Return JSON only:
{"stops":[{"harborId":"barcelona","name":"BARCELONA, SPAIN","arriveDate":null,"arriveTime":null,"departDate":"2026-10-25","departTime":"17:00"}],"skippedSea":9,"unmatched":[]}`
}

function emptyResult(): ParseItineraryResult {
  return { stops: [], skippedSea: 0, unmatched: [] }
}

function parseJson(content: string): LlmPayload | null {
  try {
    return JSON.parse(content) as LlmPayload
  } catch {
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(content.slice(start, end + 1)) as LlmPayload
    } catch {
      return null
    }
  }
}

function bindLlmPayload(payload: LlmPayload | null): ParseItineraryResult | null {
  if (!payload || !Array.isArray(payload.stops)) return null
  const unmatched = Array.isArray(payload.unmatched)
    ? payload.unmatched.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  let skippedSea = Number.isFinite(Number(payload.skippedSea)) ? Math.max(0, Number(payload.skippedSea)) : 0
  const stops: ParsedItineraryStop[] = []

  for (const raw of payload.stops) {
    const row = raw as LlmStop
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (isSeaName(name)) {
      skippedSea += 1
      continue
    }
    const harbor =
      (typeof row.harborId === 'string' ? findHarbor(row.harborId) : undefined) ??
      matchHarbor(name) ??
      matchHarbor(name.split(',')[0] ?? '')
    if (!harbor) {
      if (name) unmatched.push(name)
      continue
    }
    const arriveDate = ymd(row.arriveDate) ?? ymd(row.departDate)
    const departDate = ymd(row.departDate) ?? arriveDate
    if (!arriveDate || !departDate) {
      unmatched.push(name || harbor.name)
      continue
    }
    stops.push({
      harborId: harbor.id,
      label: name || harbor.name,
      arriveDate,
      arriveTime: hm(row.arriveTime) ?? '08:00',
      departDate,
      departTime: hm(row.departTime) ?? '17:00',
    })
  }

  if (!stops.length) return null
  return { stops, skippedSea, unmatched: [...new Set(unmatched)] }
}

function isSeaName(name: string): boolean {
  const cleaned = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return /^(cruisi?n+g|atsea|aufsee)$/.test(cleaned)
}

function ymd(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function hm(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/)
  if (!match) return null
  return `${String(Number(match[1])).padStart(2, '0')}:${String(Number(match[2])).padStart(2, '0')}`
}
