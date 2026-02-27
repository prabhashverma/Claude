# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

Always work within `C:\AIML\BookOrBounce\` only. Do not explore parent directories.

---

## Projects

| Project | Stack | Location |
|---|---|---|
| `BookOrBounce-Website/` | Vite + React 18 + TypeScript + MUI + MapLibre | Frontend SPA |
| `BookOrBounce-API/` | Python FastAPI + Agno + OpenAI + PostgreSQL | Backend API |

These are two independent repos (each has its own `.git/`).

---

## Commands

### Website (Vite + React)
```bash
cd BookOrBounce-Website
npm install
npm run dev        # dev server → http://localhost:5173
npm run build      # tsc + vite build
npm run lint       # ESLint
npm run preview    # preview production build
```

### API (Python / FastAPI)
```bash
cd BookOrBounce-API
pip install -r requirements.txt
python -m app.main          # dev server on port 7777 (Agno default)
pytest                      # run all tests
```

> **Do NOT use `uvicorn main:app --reload`** — uvicorn defaults to port 8000, which won't match the frontend proxy (targets 7777). Use `python -m app.main`.
> **No `--reload` flag** — user does not want hot reloading.

**Docker:**
```bash
docker-compose up           # API on localhost:8000 (maps 8000→container 8080)
docker build -t bookorbounce-api . && docker run -p 8080:8080 bookorbounce-api
```

---

## Architecture

### Frontend → Backend Connection

- **Dev:** Vite proxy rewrites `/api/*` → `http://localhost:7777/*`
- **Production:** `vercel.json` rewrites `/api/*` → Railway API URL; SPA catch-all `/(.*) → /index.html`
- **`VITE_API_URL`** env var overrides the base URL for cross-origin deploys (e.g. streaming from Vercel to Railway)

All API calls go through `src/api.ts`:
```typescript
export const API_BASE = VITE_API_URL || '/api';
bookOrBounceUrl(fresh)  // POST /api/bookorbounce[?fresh=true]
checkVisasUrl()         // POST /api/v1/checkvisas
```

### API Routes

| Endpoint | Purpose |
|---|---|
| `POST /bookorbounce` | Main flight validation (streaming + non-streaming) |
| `GET /bookorbounce/sample` | Sample itinerary |
| `POST /v1/checkvisas` | Visa-only check (used by CheckMapPage) |
| `GET /health` | Health check |

### Streaming (SSE)

`POST /bookorbounce?stream=true` yields events in order:
`started` → `status` → `reasoning` → `content` → `leg_done` → `done`

Vite proxy sets `cache-control: no-cache` and `x-accel-buffering: no` to prevent SSE buffering.

### Agent Architecture

Single `BookingAgent` (`agents/booking_agent.py`) evaluates the full journey per direction (departing/returning). It uses:
- **DuckDuckGo** — web search for visa/entry rules
- **`search_airport_knowledge`** — PostgreSQL vectordb (airport experiences)
- **`search_layover_knowledge`** — PostgreSQL vectordb (transit/layover rules)
- **`save_new_knowledge`** — async persistence of verified rules

**Cache:** Per-route + passport key, stored in Postgres + in-memory. Default TTL 24h. `?fresh=true` bypasses it.

**Models:** Configurable via env vars (`MODEL_ID_BOOKING_AGENT`, etc.), default `gpt-4o` / `gpt-4o-mini`.

### Input / Output Schema

**Request** (`ValidateFlightPayload`): `passengers[]` (nationality, visas, lounge_access) + `slices[]` (id, label, segments[]).

**Response** (`JourneyValidationOutput`): `global_verdict` (GO/CAUTION/NO-GO) + `overall_reasoning` + `slices[]` each containing `sections[]` (segment or layover with visa requirements, terminal info, lounge access).

### Map (CheckMapPage)

- Uses **MapLibre GL** + `react-map-gl` with a CARTO Positron base style (no MapTiler key needed)
- Custom GeoJSON country fill layer inserted **below** base label layers (`beforeId`) so country names stay visible
- Fill colors driven by a MapLibre `match` expression on `ISO_A2` property
- Countries GeoJSON loaded from `/public/countries.geojson` with CDN fallback to jsdelivr

### Frontend Data

Static data lives in `src/data/`:
- `airports.json` (781 KB) — IATA lookup with coordinates
- `countries.ts`, `countryRegions.ts`, `countryCentroids.ts` — country metadata for map/selects
- `visaTypes.ts`, `loungeCards.ts` — domain constants
- `testItineraries.ts` — sample flights for UI dev/testing

### Key Frontend Files

- `src/App.tsx` — route definitions + MUI ThemeProvider (light/dark from localStorage)
- `src/api.ts` — single source of truth for API URLs
- `src/types/itinerary.ts` — shared TypeScript types (`Passenger`, `FlightSegment`, `Itinerary`, `FormattedLeg`)
- `src/components/CheckPage.tsx` — main flight check form (most complex component)
- `src/components/CheckMapPage.tsx` — map-based visa checker

---

## Environment Variables

### Website (`.env`)
```
VITE_MAPTILER_KEY=   # Optional — unlocks extra map styles
VITE_API_URL=        # Optional — override API base for cross-origin (Vercel + Railway)
```

### API (`.env`)
```
OPENAI_API_KEY=      # Required
DATABASE_URL=        # Required — PostgreSQL connection string
MODEL_ID_BOOKING_AGENT=gpt-4o
MODEL_ID_PAYLOAD_BUILDER=gpt-4o-mini
VALIDATION_CACHE_TTL_SECONDS=86400
```

---

## Deployment

- **Website** → Vercel (auto-deploy on push to `main`)
- **API** → Railway (Dockerfile, reads `$PORT` env var, default 8080)
