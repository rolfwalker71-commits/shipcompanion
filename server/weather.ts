import type { WeatherInfo } from '../shared/types.ts'

const LABELS: Record<string, { de: string; en: string }> = {
  clear: { de: 'Sonnenschein', en: 'sunshine' },
  cloudy: { de: 'bewölkt', en: 'cloudy' },
  fog: { de: 'neblig', en: 'foggy' },
  rain: { de: 'Regen', en: 'rain' },
  snow: { de: 'Schnee', en: 'snow' },
  storm: { de: 'Gewitter', en: 'thunderstorms' },
}

const cache = new Map<string, { weather: WeatherInfo; ts: number }>()
const FRESH_MS = 30 * 60 * 1000
const STALE_MS = 12 * 60 * 60 * 1000

function skyFromCode(code: number): { de: string; en: string } {
  if (code === 0 || code === 1) return LABELS.clear
  if (code <= 3) return LABELS.cloudy
  if (code === 45 || code === 48) return LABELS.fog
  if (code >= 71 && code <= 77) return LABELS.snow
  if (code >= 95) return LABELS.storm
  if (code >= 51) return LABELS.rain
  return LABELS.cloudy
}

function pack(
  tempC: number,
  weatherCode: number,
  extra?: { timezone?: string | null; sunrise?: string | null; sunset?: string | null },
): WeatherInfo {
  const labels = skyFromCode(weatherCode)
  return {
    tempC: Math.round(tempC),
    weatherCode,
    labelDe: labels.de,
    labelEn: labels.en,
    timezone: extra?.timezone ?? null,
    sunrise: extra?.sunrise ?? null,
    sunset: extra?.sunset ?? null,
  }
}

function cacheKey(lat: number, lng: number, at: Date): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)},${at.getUTCFullYear()}-${at.getUTCMonth()}-${at.getUTCDate()}-${at.getUTCHours()}`
}

function codeFromMetSymbol(symbol: string): number {
  if (symbol.includes('thunder')) return 95
  if (symbol.includes('snow')) return 71
  if (symbol.includes('rain') || symbol.includes('sleet')) return 61
  if (symbol.includes('fog')) return 45
  if (symbol.includes('cloud')) return 2
  return 0
}

async function fromOpenMeteo(lat: number, lng: number, at: Date): Promise<WeatherInfo | null> {
  const nearNow = Math.abs(at.getTime() - Date.now()) < 2 * 60 * 60 * 1000
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lng))
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('current_weather', 'true')
  url.searchParams.set('daily', 'sunrise,sunset')
  url.searchParams.set('forecast_days', '1')
  if (!nearNow) {
    url.searchParams.set('hourly', 'temperature_2m,weather_code')
    url.searchParams.set('forecast_days', '8')
  }

  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  const data = (await response.json()) as {
    timezone?: string
    current_weather?: { temperature?: number; weathercode?: number }
    daily?: { sunrise?: string[]; sunset?: string[] }
    hourly?: { time: string[]; temperature_2m: number[]; weather_code: number[] }
  }
  const extra = {
    timezone: data.timezone ?? null,
    sunrise: data.daily?.sunrise?.[0] ?? null,
    sunset: data.daily?.sunset?.[0] ?? null,
  }

  if (
    nearNow &&
    typeof data.current_weather?.temperature === 'number' &&
    typeof data.current_weather.weathercode === 'number'
  ) {
    return pack(data.current_weather.temperature, data.current_weather.weathercode, extra)
  }

  const times = data.hourly?.time
  if (!times?.length) return null
  const target = at.getTime()
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < times.length; i += 1) {
    const diff = Math.abs(new Date(times[i]).getTime() - target)
    if (diff < bestDiff) {
      best = i
      bestDiff = diff
    }
  }
  const tempC = data.hourly?.temperature_2m[best]
  const weatherCode = data.hourly?.weather_code[best]
  if (typeof tempC !== 'number' || typeof weatherCode !== 'number') return null
  return pack(tempC, weatherCode, extra)
}

async function fromMetNorway(lat: number, lng: number, at: Date): Promise<WeatherInfo | null> {
  const url = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ShipCompanion/1.0 (cruise family tracker)',
    },
  })
  if (!response.ok) return null
  const data = (await response.json()) as {
    properties?: {
      timeseries?: {
        time: string
        data: {
          instant?: { details?: { air_temperature?: number } }
          next_1_hours?: { summary?: { symbol_code?: string } }
          next_6_hours?: { summary?: { symbol_code?: string } }
        }
      }[]
    }
  }
  const series = data.properties?.timeseries
  if (!series?.length) return null
  const target = at.getTime()
  let best = series[0]
  let bestDiff = Infinity
  for (const row of series) {
    const diff = Math.abs(new Date(row.time).getTime() - target)
    if (diff < bestDiff) {
      best = row
      bestDiff = diff
    }
  }
  const tempC = best.data.instant?.details?.air_temperature
  const symbol = best.data.next_1_hours?.summary?.symbol_code ?? best.data.next_6_hours?.summary?.symbol_code ?? 'clearsky'
  if (typeof tempC !== 'number') return null
  return pack(tempC, codeFromMetSymbol(symbol))
}

export async function fetchWeather(
  lat: number,
  lng: number,
  at: Date,
): Promise<WeatherInfo | null> {
  const key = cacheKey(lat, lng, at)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < FRESH_MS) return cached.weather

  const fresh =
    (await fromOpenMeteo(lat, lng, at).catch(() => null)) ??
    (await fromMetNorway(lat, lng, at).catch(() => null))

  if (fresh) {
    cache.set(key, { weather: fresh, ts: Date.now() })
    return fresh
  }

  if (cached && Date.now() - cached.ts < STALE_MS) return cached.weather
  return null
}
