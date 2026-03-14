"""
Build employer reference table from FEIN data, then backfill FEINs onto older records.

Steps:
1. Extract all records with FEIN (FY2024+) → build canonical employer table
2. Backfill FEIN onto FY2021–FY2023 via exact, normalized, and fuzzy+location matching
"""

import re
import sqlite3
from collections import Counter
from pathlib import Path

DB_PATH = Path(__file__).parent / "perm.db"

# Suffixes to strip for normalized matching
SUFFIXES = re.compile(
    r",?\s*\b(inc\.?|incorporated|llc|l\.?l\.?c\.?|corp\.?|corporation|"
    r"co\.?|company|ltd\.?|limited|l\.?p\.?|lp|llp|l\.?l\.?p\.?|"
    r"pllc|p\.?l\.?l\.?c\.?|p\.?c\.?|plc|s\.?a\.?|gmbh|ag|n\.?a\.?|"
    r"u\.?s\.?a\.?)\s*\.?\s*$",
    re.IGNORECASE,
)


def normalize_name(name: str) -> str:
    """Lowercase, strip suffixes, collapse whitespace."""
    if not name:
        return ""
    n = name.strip().lower()
    # Iteratively strip suffixes (some names have multiple: "Foo Inc. LLC")
    for _ in range(3):
        prev = n
        n = SUFFIXES.sub("", n).strip().rstrip(",").strip()
        if n == prev:
            break
    # Collapse whitespace
    n = re.sub(r"\s+", " ", n)
    return n


def build_employer_table(conn):
    """Build the `employer` reference table from FEIN-bearing records."""
    print("Building employer reference table...")

    conn.execute("DROP TABLE IF EXISTS employer")
    conn.execute("""
        CREATE TABLE employer (
            FEIN TEXT PRIMARY KEY,
            CANONICAL_NAME TEXT,
            CITY TEXT,
            STATE TEXT,
            NAICS_CODE TEXT,
            NUM_EMPLOYEES TEXT,
            FILING_COUNT INTEGER,
            NAME_VARIANTS TEXT
        )
    """)

    # Fetch all records that have a FEIN
    rows = conn.execute("""
        SELECT EMPLOYER_FEIN, EMPLOYER_NAME, EMPLOYER_CITY, EMPLOYER_STATE,
               NAICS_CODE, EMPLOYER_NUM_EMPLOYEES
        FROM perm
        WHERE EMPLOYER_FEIN IS NOT NULL AND EMPLOYER_FEIN != ''
    """).fetchall()

    print(f"  Records with FEIN: {len(rows):,}")

    # Group by FEIN
    fein_data = {}
    for fein, name, city, state, naics, num_emp in rows:
        fein = fein.strip()
        if not fein:
            continue
        if fein not in fein_data:
            fein_data[fein] = {
                "names": [],
                "cities": [],
                "states": [],
                "naics": [],
                "num_emp": [],
            }
        if name:
            fein_data[fein]["names"].append(name.strip())
        if city:
            fein_data[fein]["cities"].append(city.strip())
        if state:
            fein_data[fein]["states"].append(state.strip())
        if naics:
            fein_data[fein]["naics"].append(naics.strip())
        if num_emp:
            fein_data[fein]["num_emp"].append(num_emp.strip())

    print(f"  Unique FEINs: {len(fein_data):,}")

    # Insert into employer table
    inserts = []
    for fein, data in fein_data.items():
        name_counts = Counter(data["names"])
        canonical = name_counts.most_common(1)[0][0] if name_counts else ""
        variants = sorted(set(data["names"]))
        city = Counter(data["cities"]).most_common(1)[0][0] if data["cities"] else None
        state = Counter(data["states"]).most_common(1)[0][0] if data["states"] else None
        naics = Counter(data["naics"]).most_common(1)[0][0] if data["naics"] else None
        num_emp = Counter(data["num_emp"]).most_common(1)[0][0] if data["num_emp"] else None
        filing_count = len(data["names"])

        inserts.append((
            fein, canonical, city, state, naics, num_emp,
            filing_count, "|".join(variants),
        ))

    conn.executemany(
        "INSERT INTO employer VALUES (?, ?, ?, ?, ?, ?, ?, ?)", inserts
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_emp_canonical ON employer(CANONICAL_NAME)")
    conn.commit()
    print(f"  Employer table: {len(inserts):,} rows")
    return fein_data


def build_name_lookup(conn):
    """Build lookup dicts: exact name → FEIN, normalized name → FEIN."""
    rows = conn.execute("SELECT FEIN, NAME_VARIANTS FROM employer").fetchall()

    exact_lookup = {}    # exact name (uppercased) → FEIN
    norm_lookup = {}     # normalized name → FEIN

    for fein, variants_str in rows:
        if not variants_str:
            continue
        for name in variants_str.split("|"):
            key = name.strip().upper()
            if key:
                exact_lookup[key] = fein
            nkey = normalize_name(name)
            if nkey:
                norm_lookup[nkey] = fein

    return exact_lookup, norm_lookup


def build_norm_state_lookup(conn):
    """Build normalized name + state → FEIN for fuzzy+location matching."""
    rows = conn.execute("SELECT FEIN, NAME_VARIANTS, STATE FROM employer").fetchall()
    lookup = {}  # (normalized_name, state) → FEIN
    for fein, variants_str, state in rows:
        if not variants_str or not state:
            continue
        for name in variants_str.split("|"):
            nkey = normalize_name(name)
            if nkey:
                lookup[(nkey, state.strip().upper())] = fein
    return lookup


def backfill_feins(conn):
    """Backfill FEINs onto records that don't have one."""
    print("\nBackfilling FEINs onto older records...")

    # Count records without FEIN
    total_missing = conn.execute(
        "SELECT COUNT(*) FROM perm WHERE EMPLOYER_FEIN IS NULL OR EMPLOYER_FEIN = ''"
    ).fetchone()[0]
    print(f"  Records missing FEIN: {total_missing:,}")

    if total_missing == 0:
        print("  Nothing to backfill.")
        return

    exact_lookup, norm_lookup = build_name_lookup(conn)
    norm_state_lookup = build_norm_state_lookup(conn)

    # Fetch all records without FEIN
    rows = conn.execute("""
        SELECT rowid, EMPLOYER_NAME, EMPLOYER_STATE
        FROM perm
        WHERE EMPLOYER_FEIN IS NULL OR EMPLOYER_FEIN = ''
    """).fetchall()

    exact_matches = 0
    norm_matches = 0
    fuzzy_matches = 0
    updates = []  # (fein, rowid)

    for rowid, name, state in rows:
        if not name:
            continue

        # 1. Exact match
        key = name.strip().upper()
        fein = exact_lookup.get(key)
        if fein:
            updates.append((fein, rowid))
            exact_matches += 1
            continue

        # 2. Normalized match
        nkey = normalize_name(name)
        fein = norm_lookup.get(nkey)
        if fein:
            updates.append((fein, rowid))
            norm_matches += 1
            continue

        # 3. Fuzzy + location (normalized name + same state)
        if nkey and state:
            fein = norm_state_lookup.get((nkey, state.strip().upper()))
            if fein:
                updates.append((fein, rowid))
                fuzzy_matches += 1
                continue

    # Batch update
    if updates:
        conn.executemany("UPDATE perm SET EMPLOYER_FEIN = ? WHERE rowid = ?", updates)
        conn.commit()

    matched = exact_matches + norm_matches + fuzzy_matches
    rate = (matched / total_missing * 100) if total_missing > 0 else 0
    print(f"\n  Match results:")
    print(f"    Exact name match:       {exact_matches:,}")
    print(f"    Normalized match:       {norm_matches:,}")
    print(f"    Fuzzy + location match: {fuzzy_matches:,}")
    print(f"    Total matched:          {matched:,} / {total_missing:,} ({rate:.1f}%)")
    print(f"    Unmatched:              {total_missing - matched:,}")


def print_stats(conn):
    """Print final FEIN coverage stats."""
    print(f"\n{'='*50}")
    print("FEIN coverage by fiscal year:")
    rows = conn.execute("""
        SELECT FISCAL_YEAR,
               COUNT(*) as total,
               SUM(CASE WHEN EMPLOYER_FEIN IS NOT NULL AND EMPLOYER_FEIN != '' THEN 1 ELSE 0 END) as with_fein
        FROM perm
        GROUP BY FISCAL_YEAR
        ORDER BY FISCAL_YEAR
    """).fetchall()
    for fy, total, with_fein in rows:
        pct = (with_fein / total * 100) if total > 0 else 0
        print(f"  {fy}: {with_fein:,} / {total:,} ({pct:.1f}%)")

    total_emp = conn.execute("SELECT COUNT(*) FROM employer").fetchone()[0]
    print(f"\nEmployer reference table: {total_emp:,} entities")
    print(f"{'='*50}")


def main():
    conn = sqlite3.connect(str(DB_PATH))
    build_employer_table(conn)
    backfill_feins(conn)
    print_stats(conn)
    conn.close()
    print(f"\nDone. DB: {DB_PATH}")


if __name__ == "__main__":
    main()
