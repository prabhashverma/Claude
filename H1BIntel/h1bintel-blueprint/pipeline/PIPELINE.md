# H1BIntel Pipeline — Build Specification
# Python ETL system for processing DOL LCA + PERM data

## Overview
Agentic, resumable ETL pipeline that transforms raw DOL xlsx files
into a clean production Postgres database. Runs every 6 months when
DOL releases new data. Total runtime: ~45 minutes for a full year file.

## Tech Stack
- Python 3.11
- pandas + pyarrow       (data processing)
- openpyxl               (xlsx reading)
- asyncpg                (Postgres async driver)
- rapidfuzz              (fuzzy pre-matching before LLM)
- openai                 (DeepSeek V3 via OpenAI-compatible API)
- rich                   (terminal progress / logging)
- python-dotenv          (env vars)

## Install
```bash
pip install pandas pyarrow openpyxl asyncpg rapidfuzz openai rich python-dotenv
```

## Usage
```bash
# Fresh run
python orchestrator.py --lca data/raw/LCA_FY2025_Q4.xlsx \
                       --perm data/raw/PERM_FY2025.xlsx

# Resume after crash or review
python orchestrator.py --resume --run-id FY2025_Q4_20250314

# Skip human review (auto-approve all)
python orchestrator.py --lca ... --perm ... --auto-approve
```

## Pipeline Stages (in order)
1.  parse_lca            → read xlsx, detect columns, basic structure
2.  parse_perm           → same for PERM file
3.  normalize_lca        → wages, states, dates, visa type, amendments
4.  normalize_perm       → wages, states, dates, audit flags
5.  entity_recon         → LLM employer name reconciliation ← KEY STAGE
6.  title_normalization  → LLM job title → canonical + SOC
7.  link_lca_perm        → connect LCA ↔ PERM by employer+SOC+state
8.  compute_scores       → sponsor scores + salary benchmarks
9.  load_staging         → write all to _staging tables
10. human_review         → PAUSE — admin reviews flagged items
11. load_production      → atomic swap staging → production

## File: orchestrator.py
```python
import asyncio
import argparse
from rich.console import Console
from state import PipelineState
from agents.parser_agent import ParserAgent
from agents.normalizer_agent import NormalizerAgent
from agents.entity_agent import EntityAgent
from agents.title_agent import TitleAgent
from agents.linker_agent import LinkerAgent
from agents.scorer_agent import ScorerAgent
from agents.loader_agent import LoaderAgent

console = Console()

STAGES = [
    ("parse_lca",           ParserAgent,     {"file_type": "lca"}),
    ("parse_perm",          ParserAgent,     {"file_type": "perm"}),
    ("normalize_lca",       NormalizerAgent, {"file_type": "lca"}),
    ("normalize_perm",      NormalizerAgent, {"file_type": "perm"}),
    ("entity_recon",        EntityAgent,     {}),
    ("title_normalization", TitleAgent,      {}),
    ("link_lca_perm",       LinkerAgent,     {}),
    ("compute_scores",      ScorerAgent,     {}),
    ("load_staging",        LoaderAgent,     {"target": "staging"}),
]

async def run_pipeline(args):
    state = PipelineState.load(args.run_id) if args.resume else PipelineState.create(
        lca_file=args.lca,
        perm_file=args.perm
    )
    
    for stage_name, AgentClass, kwargs in STAGES:
        if stage_name in state.completed_stages:
            console.print(f"[dim]✓ Skipping {stage_name}[/dim]")
            continue
        
        console.print(f"\n[bold blue]→ {stage_name}[/bold blue]")
        agent = AgentClass(state=state, **kwargs)
        
        try:
            result = await agent.run()
            state.mark_complete(stage_name, result)
            console.print(f"[green]✓ {stage_name} complete[/green] {result.summary()}")
        except Exception as e:
            state.mark_failed(stage_name, str(e))
            console.print(f"[red]✗ {stage_name} failed: {e}[/red]")
            raise
    
    # Pause for human review if needed
    review_count = len(state.review_items)
    if review_count > 0 and not args.auto_approve:
        console.print(f"\n[yellow]⚠️  {review_count} items need review[/yellow]")
        console.print(f"File: data/review/review_{state.run_id}.json")
        console.print(f"Edit and run: python orchestrator.py --resume --run-id {state.run_id}")
        state.status = "paused_for_review"
        state.save()
        return
    
    # Load to production
    console.print(f"\n[bold blue]→ load_production[/bold blue]")
    loader = LoaderAgent(state=state, target="production")
    await loader.run()
    
    state.status = "completed"
    state.save()
    console.print("\n[bold green]✅ Pipeline complete![/bold green]")
    console.print(state.final_summary())

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lca", help="Path to LCA xlsx file")
    parser.add_argument("--perm", help="Path to PERM xlsx file")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--run-id", help="Run ID to resume")
    parser.add_argument("--auto-approve", action="store_true")
    args = parser.parse_args()
    asyncio.run(run_pipeline(args))
```

## File: state.py
```python
import json
import uuid
from datetime import datetime
from dataclasses import dataclass, field
from pathlib import Path

STATE_DIR = Path("data/state")

@dataclass
class PipelineState:
    run_id: str
    status: str = "running"
    lca_file: str = ""
    perm_file: str = ""
    completed_stages: list = field(default_factory=list)
    current_stage: str = ""
    stats: dict = field(default_factory=dict)
    review_items: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    started_at: str = ""
    
    @classmethod
    def create(cls, lca_file, perm_file):
        run_id = f"RUN_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        state = cls(
            run_id=run_id,
            lca_file=lca_file,
            perm_file=perm_file,
            started_at=datetime.now().isoformat()
        )
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        state.save()
        return state
    
    @classmethod
    def load(cls, run_id):
        path = STATE_DIR / f"{run_id}.json"
        with open(path) as f:
            data = json.load(f)
        return cls(**data)
    
    def save(self):
        path = STATE_DIR / f"{self.run_id}.json"
        with open(path, "w") as f:
            json.dump(self.__dict__, f, indent=2)
    
    def mark_complete(self, stage, result):
        self.completed_stages.append(stage)
        self.current_stage = stage
        self.stats[stage] = result.to_dict() if hasattr(result, "to_dict") else {}
        self.review_items.extend(result.review_items if hasattr(result, "review_items") else [])
        self.save()
    
    def mark_failed(self, stage, error):
        self.errors.append({"stage": stage, "error": error, "time": datetime.now().isoformat()})
        self.status = "failed"
        self.save()
    
    def final_summary(self):
        return f"""
Run ID: {self.run_id}
LCA rows: {self.stats.get('normalize_lca', {}).get('clean_rows', 'N/A')}
PERM rows: {self.stats.get('normalize_perm', {}).get('clean_rows', 'N/A')}
New employers: {self.stats.get('entity_recon', {}).get('new_employers', 'N/A')}
Review items: {len(self.review_items)}
        """
```

## File: agents/parser_agent.py
```python
"""
Parses raw DOL xlsx files into clean parquet.

KEY BEHAVIORS:
- Detects column names dynamically (they change between fiscal years)
- Separates H-1B / H-1B1 / E-3 into visa_class field
- Flags amended filings (VISA_CLASS contains "Amendment")
- Validates expected columns exist
- Saves to staging/lca_parsed.parquet or staging/perm_parsed.parquet

LCA COLUMN MAPPING (normalize these across fiscal years):
Raw name                      → Canonical name
EMPLOYER_NAME                 → employer_name
SOC_CODE / SOC_CD            → soc_code_raw
SOC_TITLE / SOC_OCCUPATIONAL_TITLE → soc_title_raw
JOB_TITLE                     → job_title_raw
FULL_TIME_POSITION            → is_full_time (Y/N → bool)
VISA_CLASS                    → visa_class (normalize variants)
TOTAL_WORKERS                 → total_workers
WAGE_RATE_OF_PAY_FROM         → wage_from_raw
WAGE_RATE_OF_PAY_TO           → wage_to_raw
WAGE_UNIT_OF_PAY              → wage_unit_raw
PREVAILING_WAGE               → prevailing_wage_raw
PW_WAGE_LEVEL                 → wage_level_raw
WORKSITE_CITY                 → worksite_city
WORKSITE_STATE                → worksite_state_raw
WORKSITE_POSTAL_CODE          → worksite_postal
DECISION_DATE                 → decision_date_raw
BEGIN_DATE                    → employment_start_raw
END_DATE                      → employment_end_raw
CASE_NUMBER                   → case_number
CASE_STATUS                   → case_status_raw
NEW_EMPLOYMENT / CONTINUED_EMPLOYMENT → employment_type

AMENDMENT DETECTION:
- If VISA_CLASS contains "Amendment" → is_amendment = True
- Strip "Amendment" from visa_class after flagging

PERM COLUMN MAPPING:
CASE_NO                       → case_number
CASE_STATUS                   → case_status_raw
EMPLOYER_NAME                 → employer_name
JOB_INFO_JOB_TITLE           → job_title_raw
JOB_INFO_EDUCATION            → education_level
JOB_INFO_EXPERIENCE_NUM_MONTHS → experience_months
WAGE_OFFER_FROM_9089          → wage_offered_raw
WAGE_UNIT_OF_PAY_9089         → wage_unit_raw
PW_AMOUNT_9089                → prevailing_wage_raw
PW_SOURCE_NAME_9089           → prevailing_wage_source
WORKSITE_CITY                 → worksite_city
WORKSITE_STATE                → worksite_state_raw
DECISION_DATE                 → decision_date_raw
REFILE                        → was_refiled
FOREIGN_WORKER_INFO_EDUCATION → (if present = person-specific)
"""
```

## File: agents/normalizer_agent.py
```python
"""
Normalizes parsed data. No LLM calls — pure rules.

WAGE NORMALIZATION:
multipliers = {
    'Year': 1,
    'yr': 1,
    'Hour': 2080,       # 40hrs × 52 weeks
    'hr': 2080,
    'Week': 52,
    'wk': 52,
    'Bi-Weekly': 26,
    'Month': 12,
    'mth': 12,
}
Use WAGE_RATE_OF_PAY_FROM (lower bound) as the wage.
Flag wages < $30,000/yr or > $1,000,000/yr as anomalies → review queue.
Part-time (is_full_time=False) kept in DB but flagged — excluded from
salary benchmarks.

STATE NORMALIZATION:
- Map full names to 2-letter codes
- Handle: "California" → "CA", "CALIFORNIA" → "CA", "Calif." → "CA"
- Unknown states → NULL with warning

CASE STATUS NORMALIZATION:
LCA:
"CERTIFIED" → "certified"
"CERTIFIED-WITHDRAWN" → "certified_withdrawn"  
"WITHDRAWN" → "withdrawn"
"DENIED" → "denied"

PERM:
"Certified" → "certified"
"Denied" → "denied"
"Withdrawn" → "withdrawn"
"Certified-Expired" → "certified_expired"

FISCAL YEAR → CALENDAR YEAR:
DOL fiscal year runs Oct 1 → Sep 30.
FY2025 = Oct 2024 → Sep 2025
For calendar_year field, use the year the decision was made:
calendar_year = YEAR(decision_date)
Label in UI: show both "FY2025" and the decision date year.

DATE PARSING:
Try multiple formats: MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY
Invalid dates → NULL with log entry

SOC CODE CLEANING:
Remove dashes and dots: "15-1252.00" → "15-1252"
If SOC is in 2010 format, map via soc_crosswalk table.
"""
```

## File: agents/entity_agent.py
```python
"""
LLM-powered employer name reconciliation.
This is the most critical agent — get it right.

ALGORITHM:
1. Extract all unique employer_name values from both LCA + PERM staging files
2. Load known_employers.csv (canonical names + IDs built up over time)
3. Phase 1 — Exact match (case-insensitive): handles ~70%
4. Phase 2 — Fuzzy pre-filter with rapidfuzz (threshold 85): handles ~20%
5. Phase 3 — LLM reconciliation for remaining ~10% (the hard cases)
6. Assign employer_id to every row in both staging files
7. Write unmatched/low-confidence to review queue

LLM PROMPT FOR ENTITY RECONCILIATION:
System: You are an expert at reconciling US employer names from 
government H1B visa filings. You understand common patterns:
- Legal suffixes (LLC, Inc, Corp, Ltd) are noise
- "TATA CONSULTANCY SERVICES" ≠ client companies like Google
- Subsidiaries can be separate entities (Amazon vs Amazon Web Services)
- Typos and abbreviations should be merged
- Foreign parent vs US subsidiary = usually SEPARATE entities
- Staffing companies should NEVER be merged with their clients

User: Given these employer names from new DOL filings, match each 
to the most likely canonical employer from the provided list.
For each name return:
{
  "raw_name": "GOOGLE LLC",
  "canonical_name": "Google",
  "employer_id": "existing-uuid-or-null",
  "is_new": false,
  "confidence": 0.99,
  "reasoning": "Standard legal suffix removal"
}

BATCH SIZE: 25 names per LLM call
MAX CONCURRENT CALLS: 5
CONFIDENCE ROUTING:
>= 0.92 → auto approve
0.75-0.91 → add to review queue (human decides)
< 0.75 → treat as new employer (conservative)

IMPORTANT EDGE CASES TO HANDLE:
1. "INFOSYS LIMITED" and "INFOSYS BPM LIMITED" → SEPARATE employers
2. "APPLE INC" and "APPLE RETAIL" → SEPARATE (different visa patterns)
3. Universities: "UNIVERSITY OF CALIFORNIA" has many campuses — keep separate
4. Hospital systems: treat each hospital as separate unless clearly same entity
5. "DELOITTE CONSULTING LLP" vs "DELOITTE & TOUCHE LLP" → SEPARATE

known_employers.csv format:
employer_id,canonical_name,employer_type,variants
uuid1,Google,direct,"GOOGLE LLC,Google Inc,GOOGLE INC"
uuid2,Tata Consultancy Services,staffing,"TCS,TATA CONSULTANCY..."
"""
```

## File: agents/title_agent.py
```python
"""
Normalizes job titles to canonical titles + SOC codes.
Runs after entity_recon.

APPROACH:
1. Extract unique (job_title_raw, soc_code_raw) combinations
2. Batch send to LLM for normalization
3. Cache results — same title seen in multiple years only processed once

LLM PROMPT:
Given these job titles from H1B visa filings, normalize each to:
- canonical_title: Clean, standard job title
- soc_code: 6-digit SOC 2018 code (e.g. "15-1252")
- wage_level_hint: Extract level indicator if present (I,II,III,IV or 1,2,3,4)
- cleaned_title: Remove client names, project names, internal codes

Examples:
"Sr. Software Engineer - Google Cloud" 
→ canonical: "Software Developer", soc: "15-1252", level: null, cleaned: "Senior Software Engineer"

"Data Scientist II (NLP/ML)" 
→ canonical: "Data Scientist", soc: "15-2051", level: 2, cleaned: "Data Scientist II"

"Consultant" (alone, no SOC context)
→ canonical: null, soc: null, flag: "ambiguous" → review queue

TITLE CONSISTENCY RULES:
- Always use SOC title as canonical when in doubt
- "Senior/Sr." → keep in cleaned_title, note level hint
- Stack names / tech names → strip from canonical
- Internal project codes → strip entirely
"""
```

## File: agents/linker_agent.py
```python
"""
Links LCA filings to PERM filings per employer.
Computes green card pipeline strength.

MATCHING LOGIC:
Match on: employer_id + soc_code + worksite_state
Year window: PERM filed within 3 years of LCA

LINK STRENGTH:
"strong"  = exact employer_id + exact soc_code + same state
"medium"  = exact employer_id + parent SOC group + same state  
"weak"    = exact employer_id + any SOC + different state

STAFFING COMPANY DETECTION:
If employer files > 200 LCA but < 20 PERM in 3 years:
→ likely staffing/consulting company
→ flag employer_type = 'staffing'
→ different score formula applies

GC PIPELINE STRENGTH:
strong_perm_rate = strong_link_perm_count / lca_certified_count

>= 0.15  → "strong"   (sponsors 15%+ for GC)
0.05-0.15 → "moderate"
0.01-0.05 → "weak"
< 0.01   → "none"
staffing  → "staffing" (different benchmark)
"""
```

## File: agents/scorer_agent.py
```python
"""
Computes Sponsor Score (0-100) per employer per fiscal year.
Also computes salary benchmarks per SOC per state.

SPONSOR SCORE FORMULA:
All components computed on LAST 3 FISCAL YEARS combined.

1. approval_rate (30% weight)
   = certified / (certified + denied)
   NOTE: withdrawn is EXCLUDED from denominator
   Staffing companies benchmarked separately
   
2. wage_competitiveness (25% weight)
   = avg(wage_offered / prevailing_wage) 
   Only full-time positions, wage levels II and III
   Score: >1.20 = 100, 1.10-1.20 = 80, 1.0-1.10 = 60, <1.0 = 0
   
3. perm_conversion (25% weight)
   = perm_certified (3yr) / lca_certified (3yr)
   Staffing companies: benchmarked vs staffing peers, not direct employers
   Score: >0.15=100, 0.05-0.15=60, 0.01-0.05=30, <0.01=0
   
4. consistency (10% weight)
   = count(years_with_>5_filings) / 5  (last 5 years)
   
5. volume_floor (10% weight)
   log10(total_lca_certified_3yr) / log10(max_employer_volume)
   Prevents tiny one-off filers from scoring high

FINAL SCORE = weighted sum × 100
TIER:
80-100 → "excellent"
60-79  → "good"
40-59  → "fair"
20-39  → "poor"
<20 or <10 total filings → "new" (insufficient data)

SALARY BENCHMARKS:
Per (soc_code, worksite_state, fiscal_year, wage_level):
Compute p10, p25, p50, p75, p90, avg
Filter: is_full_time=True, case_status='certified', is_amendment=False
Minimum 5 data points to compute benchmark — else NULL
"""
```

## File: agents/loader_agent.py
```python
"""
Loads processed data to Postgres.
Two modes: staging (during pipeline) and production (after review).

STAGING LOAD:
Write to *_staging tables.
Use COPY for bulk inserts (much faster than INSERT).
Truncate staging tables before loading.

PRODUCTION SWAP:
Call swap_staging_to_production() database function.
This is an atomic transaction — zero downtime.
After swap, recreate empty staging tables.

UPSERT STRATEGY:
employers: ON CONFLICT (employer_id) DO UPDATE
lca_filings: ON CONFLICT (case_number) DO UPDATE
perm_filings: ON CONFLICT (case_number) DO UPDATE
sponsor_stats: ON CONFLICT (employer_id, fiscal_year) DO UPDATE
salary_benchmarks: ON CONFLICT (soc_code, worksite_state, fiscal_year, wage_level) DO UPDATE

UPDATE known_employers.csv after successful load:
Add new employers discovered in this run.
"""
```

## File: tools/llm.py
```python
"""
LLM wrapper with automatic fallback.
Primary: DeepSeek V3 (cheapest frontier quality)
Fallback: Groq Llama 3.3 70B (free tier, fastest)

class LLMClient:
    async def complete(self, system, user, expect_json=True) → str
    async def complete_batch(self, items, system_template, batch_size=25) → list
    
Retry logic: 3 attempts with exponential backoff
JSON validation: if expect_json=True, validate response is valid JSON
Cost tracking: log tokens used to state
"""
```

## Data Nuances (agents must handle these)
See docs/data-nuances.md for full list.
Key ones:
1. One LCA can cover MULTIPLE workers (TOTAL_WORKERS field)
2. Amended filings inflate counts — track separately, exclude from primary stats
3. WORKSITE address ≠ employer HQ — always use worksite for location features
4. Withdrawn ≠ Denied — excluded from denial rate denominator
5. Part-time wages excluded from salary benchmarks
6. Fiscal year ≠ calendar year — surface both in UI
7. Consulting firms file LCAs for client sites — worksite = client location
8. PERM has much longer lifecycle — 2-4 years from file to decision
9. No shared key between LCA and PERM — fuzzy join only
10. SOC codes changed 2010→2018 in FY2020 — map via crosswalk

## Reference Data Files to Include
data/reference/soc_crosswalk.csv    (download from BLS website)
data/reference/state_codes.csv      (50 states + DC + territories)
data/reference/known_employers.csv  (seed with top 100 H1B sponsors)

## Tests to Write
tests/test_normalizer.py:
- wage conversion for all 6 units
- state normalization edge cases
- case status mapping
- date parsing edge cases
- fiscal → calendar year conversion

tests/test_entity.py:
- exact match works
- fuzzy match threshold
- LLM response parsing
- confidence routing
- mock LLM for unit tests

tests/test_scorer.py:
- approval rate excludes withdrawn
- wage competitiveness calculation
- score tier boundaries
- staffing company detection
