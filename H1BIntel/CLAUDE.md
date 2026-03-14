# CLAUDE.md — H1BIntel

## What Is H1BIntel
A free web tool that transforms raw US Department of Labor (DOL) disclosure data (LCA + PERM filings) into actionable intelligence for H-1B job seekers. Features: LCA search, PERM search, sponsor profiles with Sponsor Score (0–100), salary benchmarking, and an AI chat interface (Ask Intel).

## Directory Structure
```
H1BIntel/
├── CLAUDE.md                       # this file
├── h1bintel-blueprint/             # full build spec (read-only reference)
│   ├── CLAUDE.md                   # master spec
│   ├── README.md
│   ├── docs/data-nuances.md        # DOL data gotchas — READ BEFORE CODING
│   ├── pipeline/PIPELINE.md        # ETL pipeline spec
│   ├── pipeline/migrations/001_schema.sql  # Neon Postgres schema
│   └── web/FRONTEND.md             # frontend + API spec
├── pipeline/                       # Python ETL system (to be built)
│   ├── orchestrator.py
│   ├── state.py
│   ├── agents/                     # parser, normalizer, entity, title, linker, scorer, loader
│   ├── tools/
│   ├── data/
│   └── migrations/
└── web/                            # Next.js 14 app (to be built)
    ├── app/                        # App Router pages + API routes
    ├── components/
    ├── lib/
    └── hooks/
```

## Tech Stack
- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Database**: Neon Postgres (serverless) + pg_trgm + pgvector
- **Cache**: Upstash Redis
- **LLM**: DeepSeek V3 (primary), Groq/Llama (fallback)
- **Pipeline**: Python 3.11, pandas, asyncpg, rapidfuzz, openai (DeepSeek-compatible)
- **Hosting**: Vercel (web), pipeline runs locally/CI

## Commands

### Pipeline (Python ETL)
```bash
cd pipeline
pip install pandas pyarrow openpyxl asyncpg rapidfuzz openai rich python-dotenv
python orchestrator.py --lca data/raw/LCA_FY2025_Q4.xlsx --perm data/raw/PERM_FY2025.xlsx
python orchestrator.py --resume --run-id <RUN_ID>      # resume after crash/review
python orchestrator.py --lca ... --perm ... --auto-approve  # skip human review
```

### Web App (Next.js)
```bash
cd web
npm install
cp .env.example .env.local   # add DATABASE_URL, DEEPSEEK_API_KEY, UPSTASH keys
npm run dev                  # localhost:3000
npm run build
```

### Database
```bash
psql $DATABASE_URL < pipeline/migrations/001_schema.sql
```

## Environment Variables (.env.local)
```
DATABASE_URL=postgresql://...neon.tech/h1bintel
DEEPSEEK_API_KEY=
GROQ_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_SECRET=               # protects /admin routes
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Build Order
1. Run `pipeline/migrations/001_schema.sql` on Neon
2. Build and test pipeline on sample data
3. Build backend API routes (Next.js /api/)
4. Build frontend pages
5. Connect everything

## Phase 1 Scope (Weekend Build)
Build ONLY these:
- LCA Search (filters + table + map toggle)
- PERM Search (filters + table)
- Sponsor Profile page (score + charts + recent filings)
- Ask Intel (text-to-SQL chat)
- Admin upload + entity reconciliation review UI
- Pipeline: parse → normalize → entity recon → score → load

## Key Data Nuances (from docs/data-nuances.md)
1. One LCA = multiple workers (sum TOTAL_WORKERS, don't count rows)
2. Amended filings inflate counts — track separately, exclude from primary stats
3. WORKSITE ≠ employer HQ — ALWAYS use worksite for location/map features
4. Withdrawn ≠ Denied — approval rate = certified / (certified + denied)
5. Part-time wages excluded from salary benchmarks
6. Fiscal year ≠ calendar year (FY2025 = Oct 2024 – Sep 2025)
7. SOC codes changed 2010→2018 in FY2020 — map via soc_crosswalk table
8. No shared key between LCA and PERM — linker does probabilistic matching
9. Employer name inconsistency is severe — always query by employer_id after entity recon

## Pipeline Stages
1. parse_lca → parse_perm → normalize_lca → normalize_perm
2. entity_recon (LLM employer dedup — the critical stage)
3. title_normalization (LLM job title → canonical + SOC)
4. link_lca_perm (fuzzy join LCA↔PERM by employer+SOC+state)
5. compute_scores (Sponsor Score 0–100, salary benchmarks)
6. load_staging → human_review → load_production (atomic swap)

## Sponsor Score Formula (30/25/25/10/10 weights)
- approval_rate (30%) — excludes withdrawn from denominator
- wage_competitiveness (25%) — avg(offered/prevailing), full-time Level II–III only
- perm_conversion (25%) — PERM certified / LCA certified (3-year rolling)
- consistency (10%) — years with >5 filings out of last 5
- volume_floor (10%) — log-scaled total volume

## Web Pages
- `/` — Home (search bar + popular searches + stats)
- `/lca` — LCA Search (filters + table + map toggle)
- `/perm` — PERM Search (filters + table)
- `/sponsor/[employerId]` — Sponsor Profile (score + charts + filings)
- `/ask` — Ask Intel (AI chat, text-to-SQL)
- `/admin` — Upload dashboard + pipeline status
- `/admin/review` — Entity reconciliation review queue

## API Routes
- `GET /api/lca` — LCA search with filters, pagination, facets (cache 1h)
- `GET /api/perm` — PERM search (cache 1h)
- `GET /api/sponsor/:employerId` — Full sponsor profile (cache 24h)
- `GET /api/search/employers` — Autocomplete with pg_trgm (cache 1h)
- `POST /api/ask` — Ask Intel streaming SSE (text-to-SQL → execute → stream)
- `GET /api/salary` — Salary benchmarks by SOC+state+year+level (cache 24h)

## Reference Specs
For detailed specs, always consult the blueprint files:
- **Master spec**: `h1bintel-blueprint/CLAUDE.md`
- **Data nuances**: `h1bintel-blueprint/docs/data-nuances.md`
- **Pipeline spec**: `h1bintel-blueprint/pipeline/PIPELINE.md`
- **DB schema**: `h1bintel-blueprint/pipeline/migrations/001_schema.sql`
- **Frontend spec**: `h1bintel-blueprint/web/FRONTEND.md`
