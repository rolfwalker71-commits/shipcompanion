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

Tracking one ship is **free** via [aisstream.io](https://aisstream.io/) (`AISSTREAM_API_KEY`). The app stores the last coastal AIS position and interpolates while the radio is quiet. Mid-ocean there is no free satellite AIS.

Schiff und Reederei: Zahnrad → **Schiff und Route ändern**. Erst Reederei, dann Schiff. Fehlt ein Schiff: **Anderes Schiff (MMSI)**.

## Docker

```bash
docker compose up --build
```

Port **3344**. Keys stay in `.env` on the server, never in the browser bundle.

## Environment

| Variable | Purpose |
|---|---|
| `APP_ACCESS_KEY` | Family login (required) |
| `AISSTREAM_API_KEY` | Free live AIS for one ship; last position is cached |
| `OPENAI_API_KEY` | Spoken status sentence; template if empty |
| `COOKIE_SECURE` | `true` erzwingt Secure-Cookies. Hinter HTTPS sonst über `X-Forwarded-Proto`, immer `SameSite=Lax`. |
| `PORT` | HTTP port (default 3344 in production) |

Weather via [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).
