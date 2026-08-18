/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, NetworkOnly } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly())

registerRoute(
  ({ request, url }) => request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/widget',
  new NetworkOnly(),
)

registerRoute(
  ({ url }) =>
    url.hostname === 'tile.openstreetmap.org' ||
    url.hostname.endsWith('basemaps.cartocdn.com') ||
    url.hostname.endsWith('arcgisonline.com'),
  new NetworkFirst({
    cacheName: 'map-tiles',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  }),
)

self.addEventListener('push', (event) => {
  let title = 'Cruise Tracker'
  let body = 'Neues vom Schiff'
  let url = '/'
  let tag = 'cruise-family'
  try {
    const data = event.data?.json() as { title?: string; body?: string; url?: string; tag?: string }
    title = data.title || title
    body = data.body || body
    url = data.url || url
    tag = data.tag || tag
  } catch {
    const text = event.data?.text()
    if (text) body = text
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      lang: 'de',
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(String(event.notification.data?.url || '/'), self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (!client.url.startsWith(self.location.origin) || !('focus' in client)) continue
        await client.focus()
        if ('navigate' in client) await client.navigate(target)
        return
      }
      await self.clients.openWindow(target)
    }),
  )
})
