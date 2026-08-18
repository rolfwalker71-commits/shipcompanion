import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const DEV_KILL_SW = `
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
    await self.registration.unregister()
    const windows = await self.clients.matchAll({ type: 'window' })
    for (const client of windows) client.navigate(client.url)
  })())
})
`

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = Number(env.API_PORT ?? 3345)
  const webPort = Number(env.PORT ?? 3344)

  return {
  plugins: [
    {
      name: 'dev-kill-stale-sw',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split('?')[0]
          if (path !== '/sw.js' && path !== '/dev-sw.js' && !path?.startsWith('/workbox-')) {
            next()
            return
          }
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(DEV_KILL_SW)
        })
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cruise Tracker',
        short_name: 'Cruise Tracker',
        description: 'Where is the family ship right now?',
        theme_color: '#F7F3EB',
        background_color: '#F7F3EB',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        id: '/',
        scope: '/',
        start_url: '/',
        lang: 'de',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Jetzt',
            short_name: 'Jetzt',
            url: '/',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Blick',
            short_name: 'Blick',
            url: '/widget',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      injectManifest: {
        // Keep HTML out of precache — navigation already uses NetworkOnly in sw.ts.
        // Precached index.html caused installed PWAs to keep stale script hashes after deploy.
        globPatterns: ['**/*.{js,css,svg,png,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: webPort,
    host: true,
    allowedHosts: true,
    hmr: {
      protocol: 'ws',
      clientPort: webPort,
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: webPort,
    host: true,
  },
}
})
