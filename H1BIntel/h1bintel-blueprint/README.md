# H1BIntel

Free tool for H1B job seekers to find and evaluate visa sponsors.
Built on US DOL LCA + PERM disclosure data.

## Features
- **LCA Search** — Search 4M+ H-1B filings by company, title, state, wage
- **PERM Search** — Search green card filings, understand GC pipeline
- **Sponsor Profiles** — Company report cards with Sponsor Score (0-100)
- **Salary Intelligence** — Wage benchmarks by role, state, level
- **Ask Intel** — AI chat: "Who sponsors Data Scientists in Seattle?"

## Repo Structure
```
h1bintel/
├── CLAUDE.md          # Master build spec (start here)
├── pipeline/          
│   ├── PIPELINE.md    # ETL pipeline spec
│   └── migrations/
│       └── 001_schema.sql  # Run this first on Neon
├── web/
│   └── FRONTEND.md    # Frontend + backend spec
└── docs/
    └── data-nuances.md # DOL data gotchas (read before coding)
```

## Quick Start

### 1. Database
```bash
# Create Neon project at neon.tech
# Run schema
psql $DATABASE_URL < pipeline/migrations/001_schema.sql
```

### 2. Pipeline
```bash
cd pipeline
pip install -r requirements.txt
cp .env.example .env  # add DATABASE_URL, DEEPSEEK_API_KEY
python orchestrator.py --lca data/raw/LCA_FY2025_Q4.xlsx \
                       --perm data/raw/PERM_FY2025.xlsx
```

### 3. Web App
```bash
cd web
npm install
cp .env.example .env.local  # add DATABASE_URL, DEEPSEEK_API_KEY, UPSTASH keys
npm run dev
```

## Data Source
US Department of Labor, Office of Foreign Labor Certification
https://www.dol.gov/agencies/eta/foreign-labor/performance
Updated quarterly. Pipeline runs every 6 months.

## Stack
- Next.js 14, TypeScript, Tailwind CSS
- Neon Postgres (+ pgvector for future RAG)
- Upstash Redis (caching)
- DeepSeek V3 / Groq (Ask Intel)
- Vercel (hosting)
- Python 3.11, pandas (pipeline)
