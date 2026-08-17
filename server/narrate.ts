import type { Locale, WeatherInfo } from '../shared/types.ts'

type NarrateInput = {
  shipName: string
  locale: Locale
  lat: number
  lng: number
  currentPort: string | null
  nextPort: string
  arriveAt: string
  departAt: string | null
  weather: WeatherInfo | null
  atPort: boolean
  zone: string | null
  aisDestination: string | null
}

function formatWhen(iso: string, locale: Locale): string {
  const date = new Date(iso)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()

  const time = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

  if (locale === 'de') {
    if (sameDay) return `heute um ${time} Uhr`
    if (isTomorrow) return `morgen um ${time} Uhr`
    return `${new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)} um ${time} Uhr`
  }
  if (sameDay) return `today at ${time}`
  if (isTomorrow) return `tomorrow at ${time}`
  return `${new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(date)} at ${time}`
}

export function templateNarrative(input: NarrateInput): string {
  const arrival = formatWhen(input.arriveAt, input.locale)
  const departure = input.departAt ? formatWhen(input.departAt, input.locale) : null
  const sky = input.weather
    ? input.locale === 'de'
      ? input.weather.labelDe
      : input.weather.labelEn
    : null
  const temp = input.weather ? `${input.weather.tempC}°C` : null
  const stillInPort =
    input.atPort && input.departAt ? Date.now() > new Date(input.departAt).getTime() : false
  const goingOn = input.currentPort && input.currentPort !== input.nextPort

  if (input.locale === 'de') {
    const weatherBit = sky && temp ? ` bei ${temp} und ${sky}` : ''
    const where = input.zone ? ` im Gebiet ${input.zone}` : ''
    if (input.atPort && input.currentPort) {
      const berth = stillInPort
        ? `${input.shipName} liegt noch in ${input.currentPort}.`
        : `${input.shipName} liegt gerade in ${input.currentPort}.`
      if (!goingOn) return `${berth}${weatherBit ? ` Draußen ${weatherBit.trim()}.` : ''}`
      const leave = stillInPort
        ? `Ablegen war für ${departure} geplant.`
        : `Ablegen ${departure}.`
      return `${berth} ${leave} Als Nächstes ${input.nextPort}, Ankunft ${arrival}${weatherBit}.`
    }
    return `${input.shipName} ist unterwegs nach ${input.nextPort}${where}. Ankunft ${arrival}${weatherBit}.`
  }

  const weatherBit = sky && temp ? ` in ${temp} and ${sky}` : ''
  const where = input.zone ? ` in the ${input.zone}` : ''
  if (input.atPort && input.currentPort) {
    const berth = stillInPort
      ? `${input.shipName} is still in ${input.currentPort}.`
      : `${input.shipName} is in ${input.currentPort} right now.`
    if (!goingOn) return `${berth}${weatherBit ? ` It is${weatherBit}.` : ''}`
    const leave = stillInPort
      ? `Departure was scheduled for ${departure}.`
      : `Departure ${departure}.`
    return `${berth} ${leave} Next is ${input.nextPort}, arrival ${arrival}${weatherBit}.`
  }
  return `${input.shipName} is on the way to ${input.nextPort}${where}. Arrival ${arrival}${weatherBit}.`
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
Already in port now: ${input.atPort ? `yes, currently in ${input.currentPort}` : 'no, at sea'}
${stillInPort ? 'The scheduled departure time has already passed, but the ship is still at the berth.' : ''}
Scheduled departure from current port: ${input.atPort ? departure : 'not in port'}
Next destination: ${input.nextPort}
Arrival at next destination: ${formatWhen(input.arriveAt, input.locale)}
Reported sea/zone (use only if it is a real place name): ${input.zone ?? 'unknown'}
AIS destination field (ignore if it conflicts with the itinerary): ${input.aisDestination ?? 'unknown'}
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
    'v3',
    input.shipName,
    input.locale,
    input.currentPort ?? '',
    input.nextPort,
    input.arriveAt,
    input.departAt ?? '',
    input.atPort ? 'port' : 'sea',
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
