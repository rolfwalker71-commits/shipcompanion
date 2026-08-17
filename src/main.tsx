import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/plus-jakarta-sans'
import 'leaflet/dist/leaflet.css'
import './index.css'
import './lib/i18n'
import { ThemeProvider } from './lib/theme.tsx'
import { AuthProvider } from './lib/auth.tsx'
import App from './App.tsx'

registerSW({ immediate: true })

const standalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
if (standalone) document.documentElement.classList.add('standalone')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
