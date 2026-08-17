import { useEffect, useMemo, useRef } from 'react'
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { GeoPoint } from '@shared/types.ts'
import { useTheme } from '@/lib/theme'

const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

/** Coastal AIS is typically usable out to about this distance from a berth. */
const AIS_RANGE_M = 200_000

const SHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 40" fill="currentColor" aria-hidden="true"><path d="M12 1.6c2.3 4.8 6.8 9.6 7.8 17.2v11.8c0 3.5-3.3 6.4-7.8 7.4-4.5-1-7.8-3.9-7.8-7.4V18.8C5.2 11.2 9.7 6.4 12 1.6z"/><circle cx="12" cy="20" r="2.4" fill="var(--card)"/></svg>`

function shipIcon(heading: number | null) {
  const rotate = heading == null ? '' : ` style="transform: rotate(${Math.round(heading)}deg)"`
  return L.divIcon({
    className: 'cruise-div-icon',
    html: `<div class="ship-marker"${rotate}>${SHIP_SVG}</div>`,
    iconSize: [28, 44],
    iconAnchor: [14, 22],
  })
}

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="var(--card)"/></svg>`

export type MapPort = GeoPoint & {
  id: string
  name: string
  when: string
  kind: 'past' | 'current' | 'next' | 'later'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function portIcon(port: MapPort) {
  const time = `<span class="port-marker-time">${escapeHtml(port.when)}</span>`
  return L.divIcon({
    className: 'cruise-div-icon',
    html: `<div class="port-marker port-marker-${port.kind}">${PIN_SVG}<div class="port-caption"><span class="port-marker-label">${escapeHtml(port.name)}</span>${time}</div></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

function boundsKey(points: GeoPoint[]): string {
  return points.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`).join('|')
}

function MapViewport({ frame, ship }: { frame: GeoPoint[]; ship: GeoPoint }) {
  const map = useMap()
  const userMoved = useRef(false)
  const fitting = useRef(false)
  const frameRef = useRef(frame)
  const shipRef = useRef(ship)
  frameRef.current = frame
  shipRef.current = ship
  const key = boundsKey(frame)

  useEffect(() => {
    const markUser = () => {
      if (!fitting.current) userMoved.current = true
    }
    map.on('zoomstart', markUser)
    map.on('dragstart', markUser)
    return () => {
      map.off('zoomstart', markUser)
      map.off('dragstart', markUser)
    }
  }, [map])

  useEffect(() => {
    userMoved.current = false
    const fit = () => {
      const current = [shipRef.current, ...frameRef.current]
      if (userMoved.current || current.length === 0) return
      map.invalidateSize()
      const bounds = L.latLngBounds(current.map((point) => [point.lat, point.lng]))
      if (!bounds.isValid()) return
      fitting.current = true
      const topPad = Math.min(window.innerHeight * 0.28, 200)
      map.fitBounds(bounds.pad(0.18), {
        paddingTopLeft: L.point(24, topPad),
        paddingBottomRight: L.point(24, 48),
        maxZoom: 8,
        animate: false,
      })
      map.once('moveend', () => {
        fitting.current = false
      })
    }

    fit()
    const timer = window.setTimeout(fit, 200)
    const onResize = () => {
      map.invalidateSize()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [map, key])

  useEffect(() => {
    if (userMoved.current || fitting.current) return
    const bounds = map.getBounds()
    if (!bounds.contains([ship.lat, ship.lng])) {
      map.panTo([ship.lat, ship.lng], { animate: true })
    }
  }, [map, ship.lat, ship.lng])

  return null
}

type ShipMapProps = {
  position: GeoPoint
  path: GeoPoint[]
  track: GeoPoint[]
  forecast: GeoPoint[]
  ports: MapPort[]
  heading?: number | null
}

export function ShipMap({ position, path, track, forecast, ports, heading = null }: ShipMapProps) {
  const { resolved } = useTheme()
  const planColor = resolved === 'dark' ? 'oklch(0.78 0.02 85)' : 'oklch(0.45 0.03 255)'
  const aisColor = resolved === 'dark' ? 'oklch(0.78 0.09 195)' : 'oklch(0.52 0.1 195)'
  const estimateColor = resolved === 'dark' ? 'oklch(0.86 0.08 85)' : 'oklch(0.58 0.12 70)'

  const icons = useMemo(() => new Map(ports.map((port) => [port.id, portIcon(port)])), [ports])
  const vesselIcon = useMemo(() => shipIcon(heading), [heading])
  const rangePorts = useMemo(() => {
    const seen = new Set<string>()
    return ports.filter((port) => {
      const key = `${port.lat.toFixed(3)},${port.lng.toFixed(3)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [ports])

  const fitFrame = useMemo(() => {
    const next = ports.find((port) => port.kind === 'next' || port.kind === 'current')
    const from = [...ports].reverse().find((port) => port.kind === 'past')
    return [from, next].filter((port): port is MapPort => Boolean(port))
  }, [ports])

  return (
    <MapContainer
      center={[position.lat, position.lng]}
      zoom={6}
      className="h-full w-full"
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom
      zoomControl={false}
      attributionControl
    >
      <TileLayer
        key={resolved}
        attribution={TILE_ATTR}
        url={resolved === 'dark' ? DARK_TILES : LIGHT_TILES}
      />
      {rangePorts.map((port) => (
        <Circle
          key={`ais-range-${port.id}`}
          center={[port.lat, port.lng]}
          radius={AIS_RANGE_M}
          interactive={false}
          pathOptions={{
            color: aisColor,
            weight: 1,
            opacity: resolved === 'dark' ? 0.4 : 0.3,
            fillColor: aisColor,
            fillOpacity: resolved === 'dark' ? 0.07 : 0.05,
          }}
        />
      ))}
      {path.length > 1 ? (
        <Polyline
          positions={path.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: planColor, weight: 2, opacity: 0.28, dashArray: '2 10' }}
        />
      ) : null}
      {track.length > 1 ? (
        <Polyline
          positions={track.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: aisColor, weight: 4, opacity: 0.92, lineCap: 'round', lineJoin: 'round' }}
        />
      ) : null}
      {forecast.length > 1 ? (
        <Polyline
          positions={forecast.map((point) => [point.lat, point.lng])}
          pathOptions={{
            color: estimateColor,
            weight: 3.5,
            opacity: 0.85,
            dashArray: '10 12',
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      ) : null}
      {ports.map((port) =>
        port.kind === 'current' ? null : (
          <Marker key={port.id} position={[port.lat, port.lng]} icon={icons.get(port.id) ?? portIcon(port)} />
        ),
      )}
      <Marker position={[position.lat, position.lng]} icon={vesselIcon} />
      <MapViewport frame={fitFrame} ship={position} />
    </MapContainer>
  )
}
