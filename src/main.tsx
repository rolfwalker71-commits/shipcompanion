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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
