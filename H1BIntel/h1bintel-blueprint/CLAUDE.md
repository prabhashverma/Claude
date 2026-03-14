# H1BIntel — Complete Build Specification
# Hand this file to Claude Code to build the entire system

## What Is H1BIntel
A free web tool that transforms raw US Department of Labor (DOL) 
disclosure data (LCA + PERM filings) into actionable intelligence 
for H1B job seekers. Features: LCA search, PERM search, sponsor 
profiles, salary benchmarking, and an AI chat interface (Ask Intel).

## Repository Structure
```
h1bintel/
├── CLAUDE.md                    # This file
├── pipeline/                    # ETL system (Python)
│   ├── PIPELINE.md             # Pipeline-specific spec
│   ├── orchestrator.py
│   ├── state.py
│   ├── agents/
│   ├── tools/
│   ├── data/
│   └── migrations/
├── web/                         # Next.js app
│   ├── FRONTEND.md             # Frontend-specific spec
│   ├── app/                    # Next.js 14 app router
│   ├── components/
│   ├── lib/
│   └── api/
└── docs/
    └── data-nuances.md         # DOL data gotchas
```

## Build Order
1. Run pipeline/migrations/001_schema.sql on Neon first
2. Build and test pipeline on sample data
3. Build backend API routes
4. Build frontend
5. Connect everything

## Environment Variables (create .env.local)
```
# Database
DATABASE_URL=postgresql://...neon.tech/h1bintel

# LLM
DEEPSEEK_API_KEY=
GROQ_API_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_SECRET=                    # protect /admin routes
```

## Tech Stack
- Frontend: Next.js 14 (app router), TypeScript, Tailwind CSS
- Database: Neon Postgres (serverless)
- Cache: Upstash Redis
- LLM: DeepSeek V3 (primary), Groq/Llama (fallback)
- Pipeline: Python 3.11, pandas, asyncpg, rapidfuzz
- Hosting: Vercel

---

## Phase 1 — Weekend Build (Current Scope)
Build only these. Nothing else.

- LCA Search (filters + table + map toggle)
- PERM Search (filters + table)
- Sponsor Profile page (score + charts + recent filings)
- Ask Intel (text-to-SQL chat, basic queries)
- Admin upload + entity reconciliation review UI
- Pipeline: parse → normalize → entity recon → score → load

---

## Phase 2 — Post Launch Enhancements
Do NOT build these in Phase 1. Documented here for future Claude Code sessions.

### Ask Intel — Query Intelligence
- Intent classifier before SQL generation
  (discovery / comparison / personal / trend / factual / out-of-scope)
- Clarification questions for ambiguous queries
  e.g. "Amazon" → "Did you mean Amazon (tech) or Amazon Web Services?"
- Structured follow-up suggestions after every response
- Chart rendering inline in chat (bar/line via Recharts)
- Export chat data table as CSV
- Graceful out-of-scope handling with redirects
  (lottery odds, visa stamping, case status → not in DOL data)
- Cached pre-computed answers for top 100 common queries
- Multi-language support (Hindi, Mandarin, Telugu, Tamil, Korean)

### Ask Intel — Broader Query Handling
- Industry + geography queries
  "Financial services companies in DC that do H1B"
  Requires: NAICS codes on employers table (from enrichment agent)
  Requires: Metro area geographic mappings in system prompt
  (DMV = DC+MD+VA, Bay Area cities list, etc.)
- Sector benchmarking in responses
  "Infosys approval rate is average for IT staffing firms"
- Time series queries with inline charts
  "How has Google H1B changed since 2020?"

### New Features
- Salary Calculator / Offer Evaluator
  Input: title + company + state + level
  Output: percentile rank + market context + recommendation
- Company Comparison Tool
  Side-by-side 2-3 employers across all metrics
- "Is This Company Still Sponsoring?" recency indicator
  Red flag if no LCA in 18+ months
- Layoff Impact Tracker
  Cross-reference filing trends with layoffs.fyi data
- OPT/STEM OPT Deadline Helper
  Companies that historically file H1B quickly
- Prevailing Wage Lookup tool
  Input: SOC + city + level → current DOL prevailing wage
- Sponsor Score email alerts
- Immigration Timeline Estimator
  PERM → I-140 → Priority Date → GC with Visa Bulletin data
- Industry Benchmarking on sponsor profiles
- Macro Dashboard (H1B by the numbers — SEO + press)

### Data Enrichments (Pipeline Phase 2)
- enrichment_agent.py
  Adds NAICS codes + industry_group to all canonical employers
  One-time LLM batch run on top 45,000 employers (~$0.10)
  Also adds: company size tier, remote-work signal from worksite patterns
- uscis_sync.py (separate pipeline)
  Downloads USCIS H-1B Employer Data Hub quarterly
  Merges RFE rates + approval/denial into sponsor_stats
  Critical for complete sponsor quality picture
- Visa Bulletin parser
  Monthly DOS PDF → priority dates by category + country
  Powers immigration timeline estimator
- Layoffs enrichment
  One-time + periodic sync from layoffs.fyi public data

### Semantic / RAG Features
- pgvector embeddings on job titles
  Enables: "senior SWE" → finds "Software Developer"
  Resume → sponsor finder (paste resume, get matched sponsors)
- Semantic sponsor search
  "Companies like Google but smaller" via vector similarity

### Growth / Monetization Features
- Chrome extension (H1BIntel on LinkedIn)
  Shows sponsor score when viewing company on LinkedIn Jobs
- Employer self-service profile claiming
- Developer API (paid tier)
- H1B-friendly job board integration
- Glassdoor/Blind rating enrichment
- Wage compliance / red flag detection
  Surface employers with DOL wage violation findings
