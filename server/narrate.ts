import type { AisNavState, Locale, WeatherInfo } from '../shared/types.ts'
import { formatWhen as formatClock } from '../shared/time.ts'

type NarrateInput = {
  shipName: string
  locale: Locale
  lat: number
  lng: number
  currentPort: string | null
  nextPort: string | null
  arriveAt: string | null
  departAt: string | null
  weather: WeatherInfo | null
  atPort: boolean
  nav: AisNavState
  zone: string | null
  aisDestination: string | null
  aisEta: string | null
}

function formatWhen(iso: string, locale: Locale): string {
  return formatClock(iso, locale, true)
}

export function templateNarrative(input: NarrateInput): string {
  const arrival = input.arriveAt ? formatWhen(input.arriveAt, input.locale) : null
  const departure = input.departAt ? formatWhen(input.departAt, input.locale) : null
  const sky = input.weather
    ? input.locale === 'de'
      ? input.weather.labelDe
      : input.weather.labelEn
    : null
  const temp = input.weather ? `${input.weather.tempC}°C` : null
  const stillInPort =
    input.atPort && input.departAt ? Date.now() > new Date(input.departAt).getTime() : false
  const goingOn = Boolean(input.currentPort && input.nextPort && input.currentPort !== input.nextPort)

  if (input.locale === 'de') {
    const weatherBit = sky && temp ? ` bei ${temp} und ${sky}` : ''
    const where = input.zone ? ` im Gebiet ${input.zone}` : ''
    if (input.atPort && input.currentPort) {
      const berth =
        input.nav === 'anchored'
          ? `${input.shipName} liegt vor Anker vor ${input.currentPort}.`
          : stillInPort
            ? `${input.shipName} liegt noch festgemacht in ${input.currentPort}.`
            : `${input.shipName} liegt festgemacht in ${input.currentPort}.`
      if (!goingOn) return `${berth}${weatherBit ? ` Draußen ${weatherBit.trim()}.` : ''}`
      const leave = departure
        ? stillInPort
          ? `Ablegen war für ${departure} geplant.`
          : `Ablegen ${departure}.`
        : ''
      const nextBit = arrival
        ? `Als Nächstes ${input.nextPort}, Ankunft ${arrival}`
        : `Als Nächstes ${input.nextPort}`
      return `${berth} ${leave} ${nextBit}${weatherBit}.`.replace(/\s+/g, ' ').trim()
    }
    if (!input.nextPort) {
      return `${input.shipName} ist unterwegs${where}.${weatherBit ? ` Draußen ${weatherBit.trim()}.` : ''}`
    }
    const etaBit = arrival ? ` Ankunft ${arrival}.` : input.aisEta ? ` Das Schiff meldet Ankunft ${formatWhen(input.aisEta, input.locale)}.` : ''
    return `${input.shipName} ist unterwegs nach ${input.nextPort}${where}.${etaBit}${weatherBit ? weatherBit + '.' : ''}`
  }

  const weatherBit = sky && temp ? ` in ${temp} and ${sky}` : ''
  const where = input.zone ? ` in the ${input.zone}` : ''
  if (input.atPort && input.currentPort) {
    const berth =
      input.nav === 'anchored'
        ? `${input.shipName} is at anchor off ${input.currentPort}.`
        : stillInPort
          ? `${input.shipName} is still moored in ${input.currentPort}.`
          : `${input.shipName} is moored in ${input.currentPort}.`
    if (!goingOn) return `${berth}${weatherBit ? ` It is${weatherBit}.` : ''}`
    const leave = departure
      ? stillInPort
        ? `Departure was scheduled for ${departure}.`
        : `Departure ${departure}.`
      : ''
    const nextBit = arrival
      ? `Next is ${input.nextPort}, arrival ${arrival}`
      : `Next is ${input.nextPort}`
    return `${berth} ${leave} ${nextBit}${weatherBit}.`.replace(/\s+/g, ' ').trim()
  }
  if (!input.nextPort) {
    return `${input.shipName} is under way${where}.${weatherBit ? ` It is${weatherBit}.` : ''}`
  }
  const etaBit = arrival ? ` Arrival ${arrival}.` : input.aisEta ? ` The ship reports arrival ${formatWhen(input.aisEta, input.locale)}.` : ''
  return `${input.shipName} is on the way to ${input.nextPort}${where}.${etaBit}${weatherBit ? weatherBit + '.' : ''}`
}

export async function llmNarrative(input: NarrateInput): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return null
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const language = input.locale === 'de' ? 'German' : 'English'
  const weather =
    input.weather != null
      ? `${input.weather.tempC}°C, ${input.locale === 'de' ? input.weather.labelDe : input.weather.labelEn}`
      : 'unknown'
  const departure = input.departAt ? formatWhen(input.departAt, input.locale) : 'unknown'
  const stillInPort =
    input.atPort && input.departAt ? Date.now() > new Date(input.departAt).getTime() : false

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(4_000),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 110,
      messages: [
        {
          role: 'system',
          content:
            'Write one or two short factual sentences for grandparents and children. Start with the ship name, never with "Das Schiff" or "The ship". No coordinates, knots, jargon, children, adventures, or invented colour. If unsure about a sea name, skip it. Never invent facts. If the ship is already in port, it has already arrived — never say it is arriving. Departure time is when it LEAVES, not when it arrives.',
        },
        {
          role: 'user',
          content: `Language: ${language}
Ship: ${input.shipName}
Already in port now: ${input.atPort ? `yes, currently ${input.nav} in ${input.currentPort}` : `no, at sea (${input.nav})`}
${stillInPort ? 'The scheduled departure time has already passed, but the ship is still at the berth.' : ''}
AIS navigational status: ${input.nav} (moored = tied up, anchored = at anchor, underway = moving)
Scheduled departure from current port: ${input.atPort ? departure : 'not in port'}
Next destination: ${input.nextPort ?? 'unknown'}
Arrival at next destination: ${input.arriveAt ? formatWhen(input.arriveAt, input.locale) : 'unknown'}
Reported sea/zone (use only if it is a real place name): ${input.zone ?? 'unknown'}
AIS destination field: ${input.aisDestination ?? 'unknown'}
AIS reported ETA (use only if at sea and it looks plausible): ${input.aisEta ? formatWhen(input.aisEta, input.locale) : 'unknown'}
Approx position: ${input.lat.toFixed(2)}, ${input.lng.toFixed(2)} (only to name a well-known sea if obvious and at sea)
Weather: ${weather}`,
        },
      ],
    }),
  })

  if (!response.ok) return null
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  return text || null
}

const narrativeCache = new Map<string, { text: string; ts: number }>()
const CACHE_MS = 8 * 60 * 1000

export async function narrate(input: NarrateInput): Promise<string> {
  const cacheKey = [
    'v4',
    input.shipName,
    input.locale,
    input.currentPort ?? '',
    input.nextPort,
    input.arriveAt,
    input.departAt ?? '',
    input.atPort ? 'port' : 'sea',
    input.nav,
    input.aisDestination ?? '',
    input.aisEta ?? '',
    input.weather?.tempC ?? '',
    Math.round(input.lat * 10),
    Math.round(input.lng * 10),
  ].join('|')
  const cached = narrativeCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.text

  const generated = (await llmNarrative(input).catch(() => null)) ?? templateNarrative(input)
  narrativeCache.set(cacheKey, { text: generated, ts: Date.now() })
  return generated
}
