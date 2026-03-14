"""
Load PERM disclosure data (FY2021–FY2026) into SQLite.
Only stores key columns in a unified 'perm' table.
Raw Excel files live in ./Raw/

Processes one file at a time — appends to the DB so if it fails
you can re-run and it picks up where it left off (skips already-loaded FYs).
"""

import re
import sqlite3
import sys
import pandas as pd
from pathlib import Path

RAW_DIR = Path(__file__).parent / "Raw"
DB_PATH = Path(__file__).parent / "perm.db"

# Files: (filename, fiscal_year, form_type)
FILES = [
    ("PERM_FY2021.xlsx", "FY2021", "old"),
    ("PERM_FY2022.xlsx", "FY2022", "old"),
    ("PERM_FY2023.xlsx", "FY2023", "old"),
    ("PERM_FY2024.xlsx", "FY2024", "old"),
    ("PERM_FY2024_NewForm.xlsx", "FY2024_NEW", "new"),
    ("PERM_FY2025.xlsx", "FY2025", "new"),
    ("PERM_FY2026_Q1.xlsx", "FY2026_Q1", "new"),
]

# Unified column -> (old_form_col, new_form_col)
COLUMN_MAP = {
    # Case Info
    "CASE_NUMBER":            ("CASE_NUMBER",             "CASE_NUMBER"),
    "CASE_STATUS":            ("CASE_STATUS",             "CASE_STATUS"),
    "RECEIVED_DATE":          ("RECEIVED_DATE",           "RECEIVED_DATE"),
    "DECISION_DATE":          ("DECISION_DATE",           "DECISION_DATE"),
    "OCCUPATION_TYPE":        ("PROFESSIONAL_OCCUPATION", "OCCUPATION_TYPE"),
    # Employer Info
    "EMPLOYER_NAME":          ("EMPLOYER_NAME",           "EMP_BUSINESS_NAME"),
    "EMPLOYER_CITY":          ("EMPLOYER_CITY",           "EMP_CITY"),
    "EMPLOYER_STATE":         ("EMPLOYER_STATE_PROVINCE", "EMP_STATE"),
    "EMPLOYER_FEIN":          ("EMPLOYER_FEIN",            "EMP_FEIN"),
    "NAICS_CODE":             ("NAICS_CODE",              "EMP_NAICS"),
    "EMPLOYER_NUM_EMPLOYEES": ("EMPLOYER_NUM_EMPLOYEES",  "EMP_NUM_PAYROLL"),
    "EMPLOYER_YEAR_COMMENCED":("EMPLOYER_YEAR_COMMENCED_BUSINESS", "EMP_YEAR_COMMENCED"),
    # Job & Wage
    "SOC_CODE":               ("PW_SOC_CODE",             "PWD_SOC_CODE"),
    "SOC_TITLE":              ("PW_SOC_TITLE",            "PWD_SOC_TITLE"),
    "JOB_TITLE":              ("JOB_TITLE",               "JOB_TITLE"),
    "WAGE_FROM":              ("WAGE_OFFER_FROM",         "JOB_OPP_WAGE_FROM"),
    "WAGE_TO":                ("WAGE_OFFER_TO",           "JOB_OPP_WAGE_TO"),
    "WAGE_UNIT":              ("WAGE_OFFER_UNIT_OF_PAY",  "JOB_OPP_WAGE_PER"),
    # Worksite
    "WORKSITE_ADDR":          ("WORKSITE_ADDRESS_1",      "PRIMARY_WORKSITE_ADDR1"),
    "WORKSITE_CITY":          ("WORKSITE_CITY",           "PRIMARY_WORKSITE_CITY"),
    "WORKSITE_STATE":         ("WORKSITE_STATE",          "PRIMARY_WORKSITE_STATE"),
    "WORKSITE_BLS_AREA":      (None,                      "PRIMARY_WORKSITE_BLS_AREA"),
    # Attorney
    "ATTORNEY_FIRM":          ("AGENT_ATTORNEY_FIRM_NAME","ATTY_AG_LAW_FIRM_NAME"),
}

UNIFIED_COLS = ["FISCAL_YEAR"] + list(COLUMN_MAP.keys())


def create_table(conn):
    """Create the perm table if it doesn't exist."""
    cols_sql = ", ".join(f'"{c}" TEXT' for c in UNIFIED_COLS)
    conn.execute(f'CREATE TABLE IF NOT EXISTS perm ({cols_sql})')
    conn.commit()


def get_loaded_fiscal_years(conn):
    """Return set of fiscal years already in the DB."""
    try:
        cursor = conn.execute("SELECT DISTINCT FISCAL_YEAR FROM perm")
        return {row[0] for row in cursor}
    except sqlite3.OperationalError:
        return set()


def load_and_map(filepath, fiscal_year, form_type):
    """Read Excel, extract only the columns we care about."""
    print(f"  Reading {filepath.name}...")
    df = pd.read_excel(filepath, engine="openpyxl")
    print(f"  -> {len(df):,} rows")

    col_idx = 0 if form_type == "old" else 1
    unified = pd.DataFrame()
    unified["FISCAL_YEAR"] = [fiscal_year] * len(df)

    for unified_col, source_cols in COLUMN_MAP.items():
        src = source_cols[col_idx]
        if src and src in df.columns:
            unified[unified_col] = df[src].apply(
                lambda x: str(x) if pd.notna(x) and x is not None else None
            )
        else:
            alt = source_cols[1 - col_idx]
            if alt and alt in df.columns:
                unified[unified_col] = df[alt].apply(
                    lambda x: str(x) if pd.notna(x) and x is not None else None
                )
            else:
                unified[unified_col] = None

    # Normalize FEIN: strip .0, remove non-digits, format as XX-XXXXXXX
    if "EMPLOYER_FEIN" in unified.columns:
        def normalize_fein(val):
            if not val:
                return None
            # Strip trailing .0 from numeric read
            val = re.sub(r'\.0$', '', val)
            digits = re.sub(r'\D', '', val)
            if len(digits) == 9:
                return f"{digits[:2]}-{digits[2:]}"
            return val if val.strip() else None
        unified["EMPLOYER_FEIN"] = unified["EMPLOYER_FEIN"].apply(normalize_fein)

    # Normalize EMPLOYER_NAME: strip trailing whitespace
    if "EMPLOYER_NAME" in unified.columns:
        unified["EMPLOYER_NAME"] = unified["EMPLOYER_NAME"].apply(
            lambda x: x.strip() if x else x
        )

    # FY2022 uses slightly different column name
    if unified["EMPLOYER_YEAR_COMMENCED"].isna().all():
        for alt in ["EMP_YEAR_COMMENCED_BUSINESS", "EMPLOYER_YEAR_COMMENCED_BUSINESS"]:
            if alt in df.columns:
                unified["EMPLOYER_YEAR_COMMENCED"] = df[alt].apply(
                    lambda x: str(x) if pd.notna(x) else None
                )
                break

    return unified


def create_indexes(conn):
    """Create indexes (safe to re-run)."""
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_employer ON perm(EMPLOYER_NAME)",
        "CREATE INDEX IF NOT EXISTS idx_state ON perm(EMPLOYER_STATE)",
        "CREATE INDEX IF NOT EXISTS idx_status ON perm(CASE_STATUS)",
        "CREATE INDEX IF NOT EXISTS idx_fy ON perm(FISCAL_YEAR)",
        "CREATE INDEX IF NOT EXISTS idx_soc ON perm(SOC_CODE)",
        "CREATE INDEX IF NOT EXISTS idx_job ON perm(JOB_TITLE)",
        "CREATE INDEX IF NOT EXISTS idx_worksite_city ON perm(WORKSITE_CITY)",
        "CREATE INDEX IF NOT EXISTS idx_worksite_state ON perm(WORKSITE_STATE)",
        "CREATE INDEX IF NOT EXISTS idx_wage ON perm(WAGE_FROM)",
        "CREATE INDEX IF NOT EXISTS idx_attorney ON perm(ATTORNEY_FIRM)",
        "CREATE INDEX IF NOT EXISTS idx_fein ON perm(EMPLOYER_FEIN)",
    ]
    for sql in indexes:
        conn.execute(sql)
    conn.commit()


def print_summary(conn):
    """Print what's in the DB."""
    print(f"\n{'='*50}")
    cursor = conn.execute("SELECT FISCAL_YEAR, COUNT(*) FROM perm GROUP BY FISCAL_YEAR ORDER BY FISCAL_YEAR")
    total = 0
    for row in cursor:
        print(f"  {row[0]}: {row[1]:,}")
        total += row[1]
    print(f"  --------")
    print(f"  TOTAL: {total:,} rows")
    cursor = conn.execute("SELECT COUNT(DISTINCT EMPLOYER_NAME) FROM perm")
    print(f"  Unique employers: {cursor.fetchone()[0]:,}")
    print(f"{'='*50}")


def main():
    conn = sqlite3.connect(DB_PATH)
    create_table(conn)
    loaded = get_loaded_fiscal_years(conn)
    print(f"Database: {DB_PATH}")
    if loaded:
        print(f"Already loaded: {', '.join(sorted(loaded))}\n")

    for filename, fiscal_year, form_type in FILES:
        if fiscal_year in loaded:
            print(f"  SKIP {fiscal_year} (already loaded)")
            continue

        filepath = RAW_DIR / filename
        if not filepath.exists():
            print(f"  SKIP {filename} (file not found)")
            continue

        print(f"\n--- Loading {fiscal_year} ({form_type} form) ---")
        try:
            df = load_and_map(filepath, fiscal_year, form_type)
            df.to_sql("perm", conn, if_exists="append", index=False)
            conn.commit()
            print(f"  -> DONE: {len(df):,} rows inserted")
        except Exception as e:
            print(f"  -> FAILED: {e}")
            print(f"  Re-run the script to retry from {fiscal_year}")
            conn.close()
            sys.exit(1)

    create_indexes(conn)
    print_summary(conn)
    conn.close()
    print(f"\nDB saved to: {DB_PATH}")


if __name__ == "__main__":
    main()
