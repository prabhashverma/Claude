# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

Work within `C:\AIML\BookOrBounce\` only. Do not explore parent directories.

---

## Projects

| Project | Stack | Location |
|---|---|---|
| `DoINeedAVisa-Website/` | Vite 5 + React 18 + TypeScript + MUI v7 + MapLibre GL | Frontend SPA |
| `DoINeedAVisa-API/` | Python 3.10 + FastAPI + Agno + Gemini + PostgreSQL + PgVector | Backend API |

These are two independent git repos (each has its own `.git/`).

---

## Commands

### Website (Vite + React)
```bash
cd DoINeedAVisa-Website
npm install
npm run dev        # dev server → http://localhost:5173
npm run build      # tsc -b + vite build
npm run lint       # ESLint
npm run preview    # preview production build
```

No test runner configured (no Vitest/Jest/Playwright).

### API (Python / FastAPI)
```bash
cd DoINeedAVisa-API
pip install -r requirements.txt
python -m app.main          # dev server on port 7777 (Agno default)
pytest test/                # all tests (integration — hit localhost:7777)
pytest test/test02.py       # single test
```

> **Do NOT use `uvicorn main:app --reload`** — uvicorn defaults to port 8000, which won't match the frontend proxy (targets 7777). Use `python -m app.main`.

**Docker:**
```bash
docker-compose up           # API on localhost:8000 (maps 8000→container 8080)
docker build -t doineedavisa-api . && docker run -p 8080:8080 doineedavisa-api
```

---

## Architecture

### Frontend → Backend Connection

- **Dev:** Vite proxy rewrites `/api/*` → `http://localhost:7777/*` (configurable via `VITE_API_TARGET`)
- **Production:** `vercel.json` rewrites `/api/*` → Railway API URL; SPA catch-all `/(.*) → /index.html`
- **`VITE_API_URL`** env var overrides the base URL in `src/api.ts` for cross-origin deploys

All API calls go through `src/api.ts`:
```typescript
export const API_BASE = VITE_API_URL || '/api';
```

### API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /doineedavisa` | Flight validation (SSE streaming with `?stream=true`, `?fresh=true` bypasses cache) |
| `GET /doineedavisa/sample` | Sample itinerary |
| `POST /v1/checkvisas` | Non-streaming visa check (passport_index lookup) |
| `POST /v1/checkvisas/world` | SSE world scan — Tier 1 enriched results |
| `POST /v1/checkvisas/detail` | Single-country deep dive — Tier 2 (cached) |
| `POST /v1/visa-feedback` | Thumbs up/down votes (triggers correction pipeline on thumbs-down) |
| `GET /v1/visa-types/{code}` | Country-specific visa types |
| `POST /v1/admin/refresh-cache` | Cache refresh (requires `ADMIN_API_KEY`) |
| `GET /health` | Health check |

### Agent Architecture

All agents use **Gemini** models via Agno framework (NOT OpenAI).

| Agent | File | Model | Role |
|---|---|---|---|
| BookingAgent | `agents/booking_agent.py` | `gemini-2.5-flash` | Full flight validation: visa, terminal, lounge, layover |
| VisaDeepSearchAgent | `agents/visa_deep_search_agent.py` | `gemini-2.5-flash-lite` | Tier 1 world scan (Google Search grounding) |
| VisaDetailAgent | `agents/visa_detail_agent.py` | `gemini-2.5-flash` | Tier 2 single-country deep dive (Google Search + DuckDuckGo) |

BookingAgent tools: DuckDuckGo web search, `search_airport_knowledge` (PgVector RAG), `search_layover_knowledge` (PgVector RAG), `save_new_knowledge`.

### Streaming (SSE)

**Flight check** (`POST /doineedavisa?stream=true`):
`started` → `status` → `reasoning` → `agent_event` → `content` → `leg_done` → `done`

**World scan** (`POST /v1/checkvisas/world`):
`cached_batch` (pre-computed results) → `complete` (agent-enriched results)

Vite proxy injects `cache-control: no-cache` and `x-accel-buffering: no` on `text/event-stream` responses.

### Caching

- **In-memory agent cache** (`app/agent_cache.py`) — per-route + passport key
- **visa_check_cache** (`db/visa_check_cache.py`) — per-country Postgres cache, 7-day TTL
- **passport_index** (`db/passport_index.py`) — pre-computed visa data from passport-index-dataset CSV

`?fresh=true` bypasses all caches.

### Database

Auto-created tables using `_ensure_table()` pattern — no manual migrations needed for new tables.

**Pattern:** `db/<module>.py` with `_get_engine()`, `_ensure_table(conn)`, lazy singleton engine.

Key tables:
- `passport_index` — pre-computed visa requirements (ISO3 pairs)
- `visa_check_cache` — agent-enriched results with TTL
- `visa_feedback` — thumbs up/down votes
- `agent_validations` / `flight_validations` — audit trail
- `ai.*_knowledge_contents/vectors` — 4 PgVector RAG tables (visa_compliance, layover_visa, airport_experience, travel_advisory)

### Input / Output Schema

**Request** (`ValidateFlightPayload` in `app/input_schema.py`): `passengers[]` (nationality, visas, lounge_access) + `slices[]` (id, label, segments[]).

**Response** (`JourneyValidationOutput` in `app/output_schema.py`): `global_verdict` (GO/CAUTION/NO-GO) + `overall_reasoning` + `slices[]` with `sections[]`.

**Tier 2 Detail** (`VisaDetailResponse` in `app/schema.py`): summary + entry requirements + visa_detail (one of: visa_free/voa/evisa/consular/banned) + sources + data_freshness.

### Frontend Routing

Defined in `src/App.tsx`:
- `/` → HomePage (world scan + country cards)
- `/check-transit-visa` → CheckPage (flight check form)
- `/checkvisa` → CheckPage (visa-only mode)
- `/checkmap` → CheckMapPage (map-based visa checker)
- `/visa-free-countries` → VisaFreeCountriesPage
- `/what-is-doineedavisa` → About page
- Plus SEO pages, stream-test, power-flyer

### Map (CheckMapPage + FlightMap)

- **MapLibre GL** + `react-map-gl` with CARTO Positron base style (no MapTiler key needed)
- GeoJSON country fill layer inserted below base label layers (`beforeId`)
- Fill colors driven by MapLibre `match` expression on `ISO_A2` property
- Countries GeoJSON from `/public/countries.geojson` with CDN fallback

---

## Environment Variables

### Website (`.env`)
```
VITE_API_URL=        # Optional — override API base for cross-origin (Vercel + Railway)
VITE_MAPTILER_KEY=   # Optional — unlocks extra map styles
```

### API (`.env`)
```
GOOGLE_API_KEY=      # Required — Gemini models (fails fast if missing)
DATABASE_URL=        # Required — PostgreSQL connection string (fails fast if missing)
MODEL_ID_BOOKING_AGENT=gemini-2.5-flash    # default
VALIDATION_CACHE_TTL_SECONDS=86400         # 24h default
VISA_CHECK_CACHE_TTL_SECONDS=604800        # 7-day default
ADMIN_API_KEY=       # Optional — protects /v1/admin/refresh-cache
```

> Note: `.env.example` is outdated (lists `OPENAI_API_KEY` and old agent model vars). The actual code requires `GOOGLE_API_KEY`.

---

## Deployment

- **Website** → Vercel (auto-deploy on push to `main`, domain: `doineedavisa.app`)
- **API** → Railway (Dockerfile, reads `$PORT` env var, default 8080)
