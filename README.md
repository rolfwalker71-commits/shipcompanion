# Cruise Tracker

Simple PWA for family at home. One screen, a short status sentence, a map. Locked behind a shared family key.

## Run locally

```bash
cp .env.example .env
# set APP_ACCESS_KEY, VESSELS_API_KEY, optionally AISSTREAM_API_KEY and OPENAI_API_KEY
npm install
npm run dev
```

Open [http://localhost:3344](http://localhost:3344). Default local key in `.env` is `family`.

Tracking several ships is **free-to-try** via [vessels-api.com](https://vessels-api.com/) (`VESSELS_API_KEY`, one fleet call for all ships, default every 30 minutes, plus a daily track per ship for the map trail). Optional AISStream (`AISSTREAM_API_KEY`) fills in live coastal radio between polls. Optional [Data Docked](https://datadocked.com/) (`DATADOCKED_API_KEY`) adds terrestrial + satellite positions when both are stale.

Schiff und Reederei: Zahnrad → **Schiffe**. Pro Schiff eigene Route: **Schiff und Route ändern**. Fehlt ein Schiff: **Schiff hinzufügen** / **Anderes Schiff (MMSI)**.

## Docker

Image kommt von GitHub Container Registry. Auf dem Familienserver:

```bash
docker compose down && docker compose pull && docker compose up -d && docker system prune -a -f
```

`docker compose pull` holt `ghcr.io/rolfwalker71-commits/shipcompanion:latest`. Ohne `--build` — GitHub Actions baut das Image bei jedem Push auf `main`.

Danach die installierte App einmal ganz schließen und neu öffnen. `http://…:3344/api/health` zeigt `"sha"` (Git-Commit), sobald ein neues Image da ist.

Port **3344**. Keys stay in `.env` on the server, never in the browser bundle.

## Environment

| Variable | Purpose |
|---|---|
| `APP_ACCESS_KEY` | Family login (required) |
| `VESSELS_API_KEY` | Primary positions for the whole fleet (one call, default every 30 min) |
| `VESSELS_API_INTERVAL_MINUTES` | 30 or 60 (default 30; also changeable in admin settings) |
| `AISSTREAM_API_KEY` | Free live AIS between Vessels polls; last position is cached |
| `DATADOCKED_API_KEY` | Optional paid AIS when coastal AIS is quiet (default: every 3h, max 250/month) |
| `DATADOCKED_MONTHLY_LIMIT` | Local monthly request cap (default 250) |
| `DATADOCKED_MIN_INTERVAL_HOURS` | Minimum hours between paid requests (default 3) |
| `OPENAI_API_KEY` | Spoken status sentence; template if empty |
| `COOKIE_SECURE` | `true` erzwingt Secure-Cookies. Hinter HTTPS sonst über `X-Forwarded-Proto`, immer `SameSite=Lax`. |
| `PORT` | HTTP port (default 3344 in production) |

Weather via [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).
