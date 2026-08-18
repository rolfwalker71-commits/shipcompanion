# Cruise Tracker

Simple PWA for family at home. One screen, a short status sentence, a map. Locked behind a shared family key.

## Run locally

```bash
cp .env.example .env
# set APP_ACCESS_KEY, AISSTREAM_API_KEY (free), optionally OPENAI_API_KEY
npm install
npm run dev
```

Open [http://localhost:3344](http://localhost:3344). Default local key in `.env` is `family`.

Tracking one ship is **free** via [aisstream.io](https://aisstream.io/) (`AISSTREAM_API_KEY`). The app stores the last coastal AIS position and interpolates while the radio is quiet. Optional [Data Docked](https://datadocked.com/) (`DATADOCKED_API_KEY`) adds terrestrial + satellite positions when AIS is stale (1 credit per location call).

Schiff und Reederei: Zahnrad → **Schiff und Route ändern**. Erst Reederei, dann Schiff. Fehlt ein Schiff: **Anderes Schiff (MMSI)**.

## Docker

Auf dem Familienserver nach `git pull` **neu bauen**, sonst bleibt das alte Image (große AIS-Kreise, Schiff in Barcelona):

```bash
git pull
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build --force-recreate
```

Danach die installierte App einmal vollständig schließen und neu öffnen (PWA-Cache). `http://…:3344/api/health` zeigt `"sha"` — das muss zum `git rev-parse --short HEAD` passen.

Port **3344**. Keys stay in `.env` on the server, never in the browser bundle.

## Environment

| Variable | Purpose |
|---|---|
| `APP_ACCESS_KEY` | Family login (required) |
| `AISSTREAM_API_KEY` | Free live AIS for one ship; last position is cached |
| `DATADOCKED_API_KEY` | Optional paid AIS when coastal AIS is quiet (default: every 3h, max 250/month) |
| `DATADOCKED_MONTHLY_LIMIT` | Local monthly request cap (default 250) |
| `DATADOCKED_MIN_INTERVAL_HOURS` | Minimum hours between paid requests (default 3) |
| `OPENAI_API_KEY` | Spoken status sentence; template if empty |
| `COOKIE_SECURE` | `true` erzwingt Secure-Cookies. Hinter HTTPS sonst über `X-Forwarded-Proto`, immer `SameSite=Lax`. |
| `PORT` | HTTP port (default 3344 in production) |

Weather via [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).
