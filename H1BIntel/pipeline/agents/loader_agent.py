"""
Loads pipeline data to Neon Postgres.
Uses psycopg2 with batch inserts for speed.
"""

import json
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
from rich.console import Console
from state import StageResult

console = Console()

STAGING_DIR = Path("data/staging")

DB_URL = "postgresql://neondb_owner:npg_v7rUFxJVt2CA@ep-morning-bird-aia9b78v-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"

# US States reference data
STATES_DATA = [
    ("AL","Alabama","South"),("AK","Alaska","West"),("AZ","Arizona","West"),
    ("AR","Arkansas","South"),("CA","California","West"),("CO","Colorado","West"),
    ("CT","Connecticut","Northeast"),("DE","Delaware","South"),("DC","District of Columbia","South"),
    ("FL","Florida","South"),("GA","Georgia","South"),("HI","Hawaii","West"),
    ("ID","Idaho","West"),("IL","Illinois","Midwest"),("IN","Indiana","Midwest"),
    ("IA","Iowa","Midwest"),("KS","Kansas","Midwest"),("KY","Kentucky","South"),
    ("LA","Louisiana","South"),("ME","Maine","Northeast"),("MD","Maryland","South"),
    ("MA","Massachusetts","Northeast"),("MI","Michigan","Midwest"),("MN","Minnesota","Midwest"),
    ("MS","Mississippi","South"),("MO","Missouri","Midwest"),("MT","Montana","West"),
    ("NE","Nebraska","Midwest"),("NV","Nevada","West"),("NH","New Hampshire","Northeast"),
    ("NJ","New Jersey","Northeast"),("NM","New Mexico","West"),("NY","New York","Northeast"),
    ("NC","North Carolina","South"),("ND","North Dakota","Midwest"),("OH","Ohio","Midwest"),
    ("OK","Oklahoma","South"),("OR","Oregon","West"),("PA","Pennsylvania","Northeast"),
    ("RI","Rhode Island","Northeast"),("SC","South Carolina","South"),("SD","South Dakota","Midwest"),
    ("TN","Tennessee","South"),("TX","Texas","South"),("UT","Utah","West"),
    ("VT","Vermont","Northeast"),("VA","Virginia","South"),("WA","Washington","West"),
    ("WV","West Virginia","South"),("WI","Wisconsin","Midwest"),("WY","Wyoming","West"),
    ("PR","Puerto Rico","Territories"),("GU","Guam","Territories"),
    ("VI","Virgin Islands","Territories"),("AS","American Samoa","Territories"),
    ("MP","Northern Mariana Islands","Territories"),
]


def safe_val(v):
    """Convert pandas/numpy values to Python native types."""
    if pd.isna(v):
        return None
    if hasattr(v, 'item'):
        return v.item()
    return v


class LoaderAgent:
    def __init__(self, state, **kwargs):
        self.state = state
        self.conn = None

    def connect(self):
        self.conn = psycopg2.connect(DB_URL)
        self.conn.autocommit = False

    def close(self):
        if self.conn:
            self.conn.close()

    async def run(self):
        self.connect()
        cur = self.conn.cursor()

        try:
            # 0. Clear all tables (cascade to handle FK constraints)
            console.print("  Clearing existing data...")
            for t in ["sponsor_stats", "salary_benchmarks", "lca_perm_links",
                       "lca_filings", "perm_filings", "employers", "states"]:
                cur.execute(f"TRUNCATE TABLE {t} CASCADE")
            self.conn.commit()

            # 1. Load states reference
            console.print("  Loading states...")
            execute_values(cur,
                "INSERT INTO states (state_code, state_name, region) VALUES %s ON CONFLICT DO NOTHING",
                [(s[0], s[1], s[2]) for s in STATES_DATA]
            )
            console.print(f"    {len(STATES_DATA)} states loaded")

            # 2. Load employers
            console.print("  Loading employers...")
            emp_df = pd.read_parquet(STAGING_DIR / "employers.parquet")
            # employers already truncated above

            batch = []
            for _, row in emp_df.iterrows():
                variants = row.get("name_variants", [])
                if isinstance(variants, str):
                    variants = [variants]
                elif not isinstance(variants, list):
                    variants = []

                batch.append((
                    safe_val(row["employer_id"]),
                    safe_val(row["canonical_name"]),
                    variants,
                ))

            execute_values(cur,
                "INSERT INTO employers (employer_id, canonical_name, name_variants) VALUES %s ON CONFLICT (employer_id) DO UPDATE SET canonical_name = EXCLUDED.canonical_name",
                batch,
                template="(%s::uuid, %s, %s::text[])"
            )
            self.conn.commit()
            console.print(f"    {len(batch):,} employers loaded")

            # 3. Load LCA filings
            console.print("  Loading LCA filings...")
            lca_df = pd.read_parquet(STAGING_DIR / "lca_normalized.parquet")
            # lca_filings already truncated above

            lca_batch = []
            for _, row in lca_df.iterrows():
                ws = safe_val(row.get("worksite_state"))
                if ws and len(str(ws)) != 2:
                    ws = None

                lca_batch.append((
                    safe_val(row.get("case_number")),
                    safe_val(row.get("case_status", "certified")),
                    safe_val(row.get("employer_id")),
                    safe_val(row.get("employer_name", "")),
                    safe_val(row.get("job_title_raw", "")),
                    safe_val(row.get("employer_name_canonical")),
                    safe_val(row.get("visa_class", "H-1B")),
                    bool(safe_val(row.get("is_amendment", False))),
                    bool(safe_val(row.get("is_full_time", True))),
                    int(safe_val(row.get("total_workers", 1)) or 1),
                    safe_val(row.get("wage_offered_annual")),
                    safe_val(row.get("prevailing_wage")),
                    safe_val(row.get("wage_level")),
                    safe_val(row.get("worksite_city")),
                    ws,
                    int(safe_val(row.get("fiscal_year", 2025)) or 2025),
                    int(safe_val(row.get("fiscal_year", 2025)) or 2025),
                    safe_val(row.get("decision_date")),
                ))

            # Batch insert in chunks of 5000
            chunk_size = 5000
            for i in range(0, len(lca_batch), chunk_size):
                chunk = lca_batch[i:i + chunk_size]
                execute_values(cur,
                    """INSERT INTO lca_filings
                    (case_number, case_status, employer_id, employer_name_raw, job_title_raw,
                     job_title_canonical, visa_class, is_amendment, is_full_time, total_workers,
                     wage_offered_annual, prevailing_wage, wage_level,
                     worksite_city, worksite_state, fiscal_year, calendar_year, decision_date)
                    VALUES %s ON CONFLICT (case_number) DO NOTHING""",
                    chunk,
                    template="(%s, %s, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::date)"
                )
                self.conn.commit()
                if (i // chunk_size) % 5 == 0:
                    console.print(f"    LCA: {min(i + chunk_size, len(lca_batch)):,}/{len(lca_batch):,}")

            console.print(f"    {len(lca_batch):,} LCA filings loaded")

            # 4. Load PERM filings
            console.print("  Loading PERM filings...")
            perm_df = pd.read_parquet(STAGING_DIR / "perm_normalized.parquet")
            # perm_filings already truncated above

            perm_batch = []
            for _, row in perm_df.iterrows():
                ws = safe_val(row.get("worksite_state"))
                if ws and len(str(ws)) != 2:
                    ws = None

                perm_batch.append((
                    safe_val(row.get("case_number")),
                    safe_val(row.get("case_status", "certified")),
                    safe_val(row.get("employer_id")),
                    safe_val(row.get("employer_name")) or "",
                    safe_val(row.get("job_title_raw")) or "Not Specified",
                    safe_val(row.get("employer_name_canonical")),
                    safe_val(row.get("wage_offered_annual")),
                    safe_val(row.get("prevailing_wage")),
                    safe_val(row.get("worksite_city")),
                    ws,
                    safe_val(row.get("worker_citizenship")),
                    int(safe_val(row.get("fiscal_year", 2025)) or 2025),
                    int(safe_val(row.get("fiscal_year", 2025)) or 2025),
                    safe_val(row.get("decision_date")),
                    safe_val(row.get("received_date")),
                ))

            for i in range(0, len(perm_batch), chunk_size):
                chunk = perm_batch[i:i + chunk_size]
                execute_values(cur,
                    """INSERT INTO perm_filings
                    (case_number, case_status, employer_id, employer_name_raw, job_title_raw,
                     job_title_canonical, wage_offered_annual, prevailing_wage,
                     worksite_city, worksite_state, worker_citizenship,
                     fiscal_year, calendar_year, decision_date, received_date)
                    VALUES %s ON CONFLICT (case_number) DO NOTHING""",
                    chunk,
                    template="(%s, %s, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::date, %s::date)"
                )
                self.conn.commit()
                if (i // chunk_size) % 5 == 0:
                    console.print(f"    PERM: {min(i + chunk_size, len(perm_batch)):,}/{len(perm_batch):,}")

            console.print(f"    {len(perm_batch):,} PERM filings loaded")

            # 5. Load sponsor stats
            console.print("  Loading sponsor stats...")
            stats_df = pd.read_parquet(STAGING_DIR / "sponsor_stats.parquet")
            # sponsor_stats already truncated above

            stats_batch = []
            for _, row in stats_df.iterrows():
                top_titles = row.get("top_titles")
                top_worksites = row.get("top_worksites")
                score_breakdown = row.get("score_breakdown")

                # Clamp rates to fit NUMERIC(5,4) — max 9.9999
                approval = safe_val(row.get("lca_approval_rate"))
                if approval is not None:
                    approval = min(float(approval), 9.9999)
                perm_conv = safe_val(row.get("perm_conversion_rate"))
                if perm_conv is not None:
                    perm_conv = min(float(perm_conv), 9.9999)

                stats_batch.append((
                    safe_val(row.get("employer_id")),
                    int(safe_val(row.get("fiscal_year", 2025)) or 2025),
                    int(safe_val(row.get("lca_total", 0)) or 0),
                    int(safe_val(row.get("lca_certified", 0)) or 0),
                    int(safe_val(row.get("lca_withdrawn", 0)) or 0),
                    int(safe_val(row.get("lca_denied", 0)) or 0),
                    approval,
                    int(safe_val(row.get("perm_total", 0)) or 0),
                    int(safe_val(row.get("perm_certified", 0)) or 0),
                    int(safe_val(row.get("total_workers", 0)) or 0),
                    safe_val(row.get("avg_wage")),
                    safe_val(row.get("median_wage")),
                    perm_conv,
                    safe_val(row.get("gc_pipeline_strength")),
                    safe_val(row.get("sponsor_score")),
                    json.dumps(score_breakdown) if isinstance(score_breakdown, dict) else None,
                    safe_val(row.get("score_tier")),
                    json.dumps(top_titles) if isinstance(top_titles, list) else None,
                    json.dumps(top_worksites) if isinstance(top_worksites, list) else None,
                ))

            execute_values(cur,
                """INSERT INTO sponsor_stats
                (employer_id, fiscal_year, lca_total, lca_certified, lca_withdrawn, lca_denied,
                 lca_approval_rate, perm_total, perm_certified, total_workers_sponsored,
                 avg_wage_offered, median_wage_offered, perm_conversion_rate,
                 gc_pipeline_strength, sponsor_score, score_breakdown, score_tier,
                 top_titles, top_worksites)
                VALUES %s ON CONFLICT (employer_id, fiscal_year) DO UPDATE SET
                    lca_total = EXCLUDED.lca_total,
                    lca_certified = EXCLUDED.lca_certified,
                    lca_withdrawn = EXCLUDED.lca_withdrawn,
                    lca_denied = EXCLUDED.lca_denied,
                    lca_approval_rate = EXCLUDED.lca_approval_rate,
                    perm_total = EXCLUDED.perm_total,
                    perm_certified = EXCLUDED.perm_certified,
                    total_workers_sponsored = EXCLUDED.total_workers_sponsored,
                    avg_wage_offered = EXCLUDED.avg_wage_offered,
                    median_wage_offered = EXCLUDED.median_wage_offered,
                    perm_conversion_rate = EXCLUDED.perm_conversion_rate,
                    gc_pipeline_strength = EXCLUDED.gc_pipeline_strength,
                    sponsor_score = EXCLUDED.sponsor_score,
                    score_breakdown = EXCLUDED.score_breakdown,
                    score_tier = EXCLUDED.score_tier,
                    top_titles = EXCLUDED.top_titles,
                    top_worksites = EXCLUDED.top_worksites""",
                stats_batch,
                template="(%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::jsonb)"
            )
            self.conn.commit()
            console.print(f"    {len(stats_batch):,} sponsor stats loaded")

            # 6. Load salary benchmarks
            console.print("  Loading salary benchmarks...")
            bench_df = pd.read_parquet(STAGING_DIR / "salary_benchmarks.parquet")
            # salary_benchmarks already truncated above

            bench_batch = []
            for _, row in bench_df.iterrows():
                ws = safe_val(row.get("worksite_state"))
                if ws and len(str(ws)) != 2:
                    ws = None
                bench_batch.append((
                    safe_val(row.get("soc_code")),
                    ws,
                    int(safe_val(row.get("fiscal_year", 2025)) or 2025),
                    int(safe_val(row.get("sample_size", 0)) or 0),
                    safe_val(row.get("p10_wage")),
                    safe_val(row.get("p25_wage")),
                    safe_val(row.get("p50_wage")),
                    safe_val(row.get("p75_wage")),
                    safe_val(row.get("p90_wage")),
                    safe_val(row.get("avg_wage")),
                ))

            execute_values(cur,
                """INSERT INTO salary_benchmarks
                (soc_code, worksite_state, fiscal_year, sample_size,
                 p10_wage, p25_wage, p50_wage, p75_wage, p90_wage, avg_wage)
                VALUES %s ON CONFLICT DO NOTHING""",
                bench_batch,
            )
            self.conn.commit()
            console.print(f"    {len(bench_batch):,} salary benchmarks loaded")

            # Verify
            console.print("  Verifying...")
            for table in ["employers", "lca_filings", "perm_filings", "sponsor_stats", "salary_benchmarks"]:
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                console.print(f"    {table}: {count:,} rows")

        except Exception as e:
            self.conn.rollback()
            raise e
        finally:
            self.close()

        return StageResult(
            summary_text="Data loaded to Neon Postgres",
            stats={"status": "loaded"},
        )
