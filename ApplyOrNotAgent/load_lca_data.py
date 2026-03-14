"""
Load LCA (Labor Condition Application) disclosure data into SQLite.
Stores 30 key columns from ~96 total. Handles column name differences
between FY2021 and FY2024+ (H1B_DEPENDENT vs H_1B_DEPENDENT, ADDRESS_1 vs ADDRESS1).

Raw CSV files live in ./RawLCA/
Processes one file at a time — skips already-loaded fiscal-year quarters.
"""

import sqlite3
import sys
import pandas as pd
from pathlib import Path

RAW_DIR = Path(__file__).parent / "RawLCA"
DB_PATH = Path(__file__).parent / "perm.db"

# Files: (filename, fiscal_year_quarter)
FILES = [
    ("LCA_Disclosure_Data_FY2021_Q1.csv", "FY2021_Q1"),
    ("LCA_Disclosure_Data_FY2021_Q2.csv", "FY2021_Q2"),
    ("LCA_Disclosure_Data_FY2021_Q3.csv", "FY2021_Q3"),
    ("LCA_Disclosure_Data_FY2021_Q4.csv", "FY2021_Q4"),
    ("LCA_Disclosure_Data_FY2022_Q1.csv", "FY2022_Q1"),
    ("LCA_Disclosure_Data_FY2022_Q2.csv", "FY2022_Q2"),
    ("LCA_Disclosure_Data_FY2022_Q3.csv", "FY2022_Q3"),
    ("LCA_Disclosure_Data_FY2022_Q4.csv", "FY2022_Q4"),
    ("LCA_Disclosure_Data_FY2023_Q1.csv", "FY2023_Q1"),
    ("LCA_Disclosure_Data_FY2023_Q2.csv", "FY2023_Q2"),
    ("LCA_Disclosure_Data_FY2023_Q3.csv", "FY2023_Q3"),
    ("LCA_Disclosure_Data_FY2023_Q4.csv", "FY2023_Q4"),
    ("LCA_Disclosure_Data_FY2024_Q3.csv", "FY2024_Q3"),
]

# Unified column -> list of possible source column names (first match wins)
COLUMN_MAP = {
    "CASE_NUMBER":           ["CASE_NUMBER"],
    "CASE_STATUS":           ["CASE_STATUS"],
    "VISA_CLASS":            ["VISA_CLASS"],
    "RECEIVED_DATE":         ["RECEIVED_DATE"],
    "DECISION_DATE":         ["DECISION_DATE"],
    "BEGIN_DATE":            ["BEGIN_DATE"],
    "END_DATE":              ["END_DATE"],
    "EMPLOYER_NAME":         ["EMPLOYER_NAME"],
    "TRADE_NAME_DBA":        ["TRADE_NAME_DBA"],
    "EMPLOYER_CITY":         ["EMPLOYER_CITY"],
    "EMPLOYER_STATE":        ["EMPLOYER_STATE"],
    "EMPLOYER_POSTAL_CODE":  ["EMPLOYER_POSTAL_CODE"],
    "NAICS_CODE":            ["NAICS_CODE"],
    "SOC_CODE":              ["SOC_CODE"],
    "SOC_TITLE":             ["SOC_TITLE"],
    "JOB_TITLE":             ["JOB_TITLE"],
    "FULL_TIME_POSITION":    ["FULL_TIME_POSITION"],
    "TOTAL_WORKER_POSITIONS":["TOTAL_WORKER_POSITIONS"],
    "WAGE_FROM":             ["WAGE_RATE_OF_PAY_FROM"],
    "WAGE_TO":               ["WAGE_RATE_OF_PAY_TO"],
    "WAGE_UNIT":             ["WAGE_UNIT_OF_PAY"],
    "PREVAILING_WAGE":       ["PREVAILING_WAGE"],
    "PW_UNIT":               ["PW_UNIT_OF_PAY"],
    "PW_WAGE_LEVEL":         ["PW_WAGE_LEVEL"],
    "WORKSITE_CITY":         ["WORKSITE_CITY"],
    "WORKSITE_STATE":        ["WORKSITE_STATE"],
    "WORKSITE_POSTAL_CODE":  ["WORKSITE_POSTAL_CODE"],
    "ATTORNEY_FIRM":         ["LAWFIRM_NAME_BUSINESS_NAME"],
    "H1B_DEPENDENT":         ["H_1B_DEPENDENT", "H1B_DEPENDENT"],
}

UNIFIED_COLS = ["FISCAL_YEAR"] + list(COLUMN_MAP.keys())


def create_table(conn):
    """Create the lca table if it doesn't exist."""
    cols_sql = ", ".join(f'"{c}" TEXT' for c in UNIFIED_COLS)
    conn.execute(f"CREATE TABLE IF NOT EXISTS lca ({cols_sql})")
    conn.commit()


def get_loaded_quarters(conn):
    """Return set of fiscal year quarters already in the DB."""
    try:
        cursor = conn.execute("SELECT DISTINCT FISCAL_YEAR FROM lca")
        return {row[0] for row in cursor}
    except sqlite3.OperationalError:
        return set()


def load_and_map(filepath, fiscal_year_quarter):
    """Read CSV, extract only the columns we care about."""
    print(f"  Reading {filepath.name}...")
    df = pd.read_csv(filepath, low_memory=False)
    print(f"  -> {len(df):,} rows, {len(df.columns)} columns")

    unified = pd.DataFrame()
    unified["FISCAL_YEAR"] = [fiscal_year_quarter] * len(df)

    for unified_col, source_candidates in COLUMN_MAP.items():
        matched = False
        for src in source_candidates:
            if src in df.columns:
                unified[unified_col] = df[src].apply(
                    lambda x: str(x).strip() if pd.notna(x) and x is not None else None
                )
                matched = True
                break
        if not matched:
            unified[unified_col] = None

    # Normalize EMPLOYER_NAME: strip whitespace
    if "EMPLOYER_NAME" in unified.columns:
        unified["EMPLOYER_NAME"] = unified["EMPLOYER_NAME"].apply(
            lambda x: x.strip() if x else x
        )

    return unified


def create_indexes(conn):
    """Create indexes on the lca table (safe to re-run)."""
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_lca_employer ON lca(EMPLOYER_NAME)",
        "CREATE INDEX IF NOT EXISTS idx_lca_status ON lca(CASE_STATUS)",
        "CREATE INDEX IF NOT EXISTS idx_lca_visa ON lca(VISA_CLASS)",
        "CREATE INDEX IF NOT EXISTS idx_lca_soc ON lca(SOC_CODE)",
        "CREATE INDEX IF NOT EXISTS idx_lca_job ON lca(JOB_TITLE)",
        "CREATE INDEX IF NOT EXISTS idx_lca_worksite_state ON lca(WORKSITE_STATE)",
        "CREATE INDEX IF NOT EXISTS idx_lca_fy ON lca(FISCAL_YEAR)",
    ]
    for sql in indexes:
        conn.execute(sql)
    conn.commit()


def print_summary(conn):
    """Print what's in the DB."""
    print(f"\n{'='*50}")
    print("LCA records by fiscal year quarter:")
    cursor = conn.execute(
        "SELECT FISCAL_YEAR, COUNT(*) FROM lca GROUP BY FISCAL_YEAR ORDER BY FISCAL_YEAR"
    )
    total = 0
    for row in cursor:
        print(f"  {row[0]}: {row[1]:,}")
        total += row[1]
    print(f"  --------")
    print(f"  TOTAL: {total:,} rows")
    cursor = conn.execute("SELECT COUNT(DISTINCT EMPLOYER_NAME) FROM lca")
    print(f"  Unique employers: {cursor.fetchone()[0]:,}")
    # Visa class breakdown
    print(f"\nBy visa class:")
    for row in conn.execute(
        "SELECT VISA_CLASS, COUNT(*) as cnt FROM lca GROUP BY VISA_CLASS ORDER BY cnt DESC"
    ):
        print(f"  {row[0]}: {row[1]:,}")
    print(f"{'='*50}")


def main():
    conn = sqlite3.connect(str(DB_PATH))
    create_table(conn)
    loaded = get_loaded_quarters(conn)
    print(f"Database: {DB_PATH}")
    if loaded:
        print(f"Already loaded: {', '.join(sorted(loaded))}\n")

    for filename, fy_quarter in FILES:
        if fy_quarter in loaded:
            print(f"  SKIP {fy_quarter} (already loaded)")
            continue

        filepath = RAW_DIR / filename
        if not filepath.exists():
            print(f"  SKIP {filename} (file not found)")
            continue

        print(f"\n--- Loading {fy_quarter} ---")
        try:
            df = load_and_map(filepath, fy_quarter)
            df.to_sql("lca", conn, if_exists="append", index=False)
            conn.commit()
            print(f"  -> DONE: {len(df):,} rows inserted")
        except Exception as e:
            print(f"  -> FAILED: {e}")
            print(f"  Re-run the script to retry from {fy_quarter}")
            conn.close()
            sys.exit(1)

    create_indexes(conn)
    print_summary(conn)
    conn.close()
    print(f"\nDB saved to: {DB_PATH}")


if __name__ == "__main__":
    main()
