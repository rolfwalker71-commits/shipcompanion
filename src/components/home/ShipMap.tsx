import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { GeoPoint } from '@shared/types.ts'
import { useTheme } from '@/lib/theme'

const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

const SHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10.189V14"/><path d="M12 2v3"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>`

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="var(--card)"/></svg>`

const shipIcon = L.divIcon({
  className: 'cruise-div-icon',
  html: `<div class="ship-marker">${SHIP_SVG}</div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
})

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

function MapViewport({ points }: { points: GeoPoint[] }) {
  const map = useMap()

  useEffect(() => {
    const fit = () => {
      map.invalidateSize()
      if (points.length === 0) return
      const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]))
      const topPad = Math.min(window.innerHeight * 0.22, 160)
      map.fitBounds(bounds.pad(0.18), {
        paddingTopLeft: L.point(28, topPad),
        paddingBottomRight: L.point(28, 56),
        maxZoom: 8,
        animate: false,
      })
    }

    fit()
    const timer = window.setTimeout(fit, 200)
    window.addEventListener('resize', fit)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', fit)
    }
  }, [map, points])

  return null
}

type ShipMapProps = {
  position: GeoPoint
  path: GeoPoint[]
  ports: MapPort[]
}

export function ShipMap({ position, path, ports }: ShipMapProps) {
  const { resolved } = useTheme()
  const lineColor = resolved === 'dark' ? 'oklch(0.97 0.01 85)' : 'oklch(0.22 0.04 260)'
  const nextPort = ports.find((port) => port.kind === 'next') ?? ports.find((port) => port.kind === 'current')

  const icons = useMemo(() => new Map(ports.map((port) => [port.id, portIcon(port)])), [ports])

  const points = useMemo(() => [...path, position, ...ports], [path, position, ports])

  const course = useMemo(() => {
    if (!nextPort) return [] as [number, number][]
    return [
      [position.lat, position.lng],
      [nextPort.lat, nextPort.lng],
    ] as [number, number][]
  }, [nextPort, position])

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
      {path.length > 1 ? (
        <Polyline
          positions={path.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: lineColor, weight: 2, opacity: 0.28, dashArray: '2 10' }}
        />
      ) : null}
      {course.length === 2 ? (
        <Polyline
          positions={course}
          pathOptions={{ color: lineColor, weight: 3, opacity: 0.7, dashArray: '1 10' }}
        />
      ) : null}
      {ports.map((port) =>
        port.kind === 'current' ? null : (
          <Marker key={port.id} position={[port.lat, port.lng]} icon={icons.get(port.id) ?? portIcon(port)} />
        ),
      )}
      <Marker position={[position.lat, position.lng]} icon={shipIcon} />
      <MapViewport points={points} />
    </MapContainer>
  )
}
