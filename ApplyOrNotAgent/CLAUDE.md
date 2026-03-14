# ApplyOrNotAgent

PERM labor certification database with employer search and natural language queries.

## Project Structure
```
ApplyOrNotAgent/
├── Raw/                    # Raw DOL Excel files (not in git)
├── static/index.html       # Frontend — employer search UI
├── app.py                  # FastAPI backend
├── load_perm_data.py       # Excel → SQLite loader (incremental)
├── perm.db                 # SQLite database (not in git)
└── CLAUDE.md
```

## Commands
```bash
# Load/reload PERM data (incremental — skips already-loaded FYs)
python load_perm_data.py

# Run dev server
uvicorn app:app --reload --port 8000

# Query DB directly
sqlite3 perm.db "SELECT EMPLOYER_NAME, JOB_TITLE, WAGE_FROM FROM perm WHERE EMPLOYER_NAME LIKE '%Google%' LIMIT 10"
```

## API Endpoints
- `GET /api/search?q=<employer>&limit=50` — fuzzy employer search
- `GET /api/employer/<name>?limit=100` — exact employer lookup
- `GET /api/stats` — DB summary

## Database Schema
Single table `perm` with all TEXT columns. See `load_perm_data.py` for COLUMN_MAP.

Key columns: FISCAL_YEAR, CASE_NUMBER, CASE_STATUS, EMPLOYER_NAME, EMPLOYER_CITY, EMPLOYER_STATE, JOB_TITLE, SOC_CODE, SOC_TITLE, WAGE_FROM, WAGE_TO, WAGE_UNIT, WORKSITE_CITY, WORKSITE_STATE, ATTORNEY_FIRM, NAICS_CODE

## Data Source
DOL PERM disclosure: https://www.dol.gov/agencies/eta/foreign-labor/performance
- FY2021–FY2024: "old form" (154 cols, column names like EMPLOYER_NAME)
- FY2024_NEW–FY2026: "new form" (135–137 cols, column names like EMP_BUSINESS_NAME)
- load_perm_data.py maps both schemas to unified columns

## Deployment Plan
- Supabase (Postgres) to replace SQLite
- Vercel for frontend
- Railway for agentic search API
