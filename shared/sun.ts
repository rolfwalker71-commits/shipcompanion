/** Sunrise / sunset at a position. Offline-safe (no network). */

const DEG = Math.PI / 180

export type SunTimes = {
  sunrise: string
  sunset: string
}

export function sunTimes(lat: number, lng: number, at = new Date()): SunTimes | null {
  const rise = julianToDate(sunJulian(lat, lng, at, true))
  const set = julianToDate(sunJulian(lat, lng, at, false))
  if (!rise || !set) return null
  return { sunrise: rise.toISOString(), sunset: set.toISOString() }
}

/** IANA-style offset zone from longitude when the weather API has no timezone. */
export function tzFromLongitude(lng: number): string {
  const hours = Math.round(lng / 15)
  if (!Number.isFinite(hours) || hours === 0) return 'UTC'
  const clamped = Math.max(-12, Math.min(14, hours))
  const sign = clamped > 0 ? '-' : '+'
  return `Etc/GMT${sign}${Math.abs(clamped)}`
}

function sunJulian(lat: number, lng: number, at: Date, rise: boolean): number | null {
  const day = utcJulian(at)
  const n = Math.round(day - 2451545 + 0.0008)
  const jStar = n - lng / 360
  const m = (357.5291 + 0.98560028 * jStar) % 360
  const mRad = m * DEG
  const c = 1.9148 * Math.sin(mRad) + 0.02 * Math.sin(2 * mRad) + 0.0003 * Math.sin(3 * mRad)
  const lambda = ((m + c + 180 + 102.9372) % 360) * DEG
  const jTransit = 2451545 + jStar + 0.0053 * Math.sin(mRad) - 0.0069 * Math.sin(2 * lambda)
  const delta = Math.asin(Math.sin(lambda) * Math.sin(23.4397 * DEG))
  const latRad = lat * DEG
  const cosOmega =
    (Math.sin(-0.833 * DEG) - Math.sin(latRad) * Math.sin(delta)) / (Math.cos(latRad) * Math.cos(delta))
  if (cosOmega < -1 || cosOmega > 1) return null
  const omega = Math.acos(cosOmega)
  return rise ? jTransit - omega / (2 * Math.PI) : jTransit + omega / (2 * Math.PI)
}

function utcJulian(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5
}

function julianToDate(julian: number | null): Date | null {
  if (julian == null || !Number.isFinite(julian)) return null
  return new Date((julian - 2_440_587.5) * 86_400_000)
}
