"""
Normalizes parsed data: wages to annual, states to 2-letter codes,
dates, case statuses, fiscal/calendar year derivation.
No LLM calls — pure rules.
"""

import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
from rich.console import Console
from state import StageResult

console = Console()

STAGING_DIR = Path("data/staging")

# Wage unit → annual multiplier
WAGE_MULTIPLIERS = {
    "year": 1,
    "yr": 1,
    "hour": 2080,
    "hr": 2080,
    "week": 52,
    "wk": 52,
    "bi-weekly": 26,
    "bi weekly": 26,
    "month": 12,
    "mth": 12,
}

# State name → 2-letter code
STATE_MAP = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
    "puerto rico": "PR", "guam": "GU", "virgin islands": "VI",
    "american samoa": "AS", "northern mariana islands": "MP",
}

# Also accept abbreviations and common variants
STATE_ABBREVS = {v: v for v in STATE_MAP.values()}  # "CA" -> "CA"
STATE_ABBREVS.update({
    "calif.": "CA", "calif": "CA", "wash.": "WA", "wash": "WA",
    "mass.": "MA", "mass": "MA", "penn.": "PA", "penn": "PA",
    "mich.": "MI", "mich": "MI", "minn.": "MN", "minn": "MN",
    "conn.": "CT", "conn": "CT", "tenn.": "TN", "tenn": "TN",
    "wis.": "WI", "wis": "WI", "ore.": "OR", "ore": "OR",
    "okla.": "OK", "okla": "OK", "ariz.": "AZ", "ariz": "AZ",
    "colo.": "CO", "colo": "CO",
})

# LCA case status normalization
LCA_STATUS_MAP = {
    "certified": "certified",
    "certified - withdrawn": "certified_withdrawn",
    "certified-withdrawn": "certified_withdrawn",
    "withdrawn": "withdrawn",
    "denied": "denied",
}

# PERM case status normalization
PERM_STATUS_MAP = {
    "certified": "certified",
    "denied": "denied",
    "withdrawn": "withdrawn",
    "certified-expired": "certified_expired",
    "certified - expired": "certified_expired",
}

# Wage level extraction
WAGE_LEVEL_MAP = {
    "i": 1, "1": 1, "level i": 1, "level 1": 1,
    "ii": 2, "2": 2, "level ii": 2, "level 2": 2,
    "iii": 3, "3": 3, "level iii": 3, "level 3": 3,
    "iv": 4, "4": 4, "level iv": 4, "level 4": 4,
}


def normalize_state(val):
    """Convert state name/abbreviation/variant to 2-letter code."""
    if pd.isna(val):
        return None
    s = str(val).strip().lower()
    # Check exact 2-letter code first
    if s.upper() in STATE_ABBREVS.values():
        return s.upper()
    # Check abbreviations/variants
    if s in STATE_ABBREVS:
        return STATE_ABBREVS[s]
    # Check full name
    if s in STATE_MAP:
        return STATE_MAP[s]
    return None


def normalize_wage(wage_raw, unit_raw):
    """Convert wage to annual. Returns None for invalid."""
    if pd.isna(wage_raw):
        return None
    try:
        wage = float(str(wage_raw).replace(",", "").replace("$", "").strip())
    except (ValueError, TypeError):
        return None

    if pd.isna(unit_raw):
        # Heuristic: if wage > 500, assume annual; if < 500, assume hourly
        if wage > 500:
            return wage
        return wage * 2080

    unit = str(unit_raw).strip().lower()
    multiplier = WAGE_MULTIPLIERS.get(unit, 1)
    annual = wage * multiplier

    # Sanity check: if result is absurdly high, the unit is likely wrong
    # e.g. $110,000 marked as "Hour" → $228B annual — clearly mislabeled
    if multiplier > 1 and annual > 1_000_000 and wage > 500:
        # The raw wage itself looks like an annual salary, ignore the unit
        return wage

    return annual


def parse_date(val):
    """Try multiple date formats."""
    if pd.isna(val):
        return None
    if isinstance(val, datetime):
        return val
    s = str(val).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y/%m/%d", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def extract_wage_level(val):
    """Extract wage level (1-4) from string."""
    if pd.isna(val):
        return None
    s = str(val).strip().lower()
    # Try direct mapping
    if s in WAGE_LEVEL_MAP:
        return WAGE_LEVEL_MAP[s]
    # Try to find a roman numeral or digit
    for key, level in WAGE_LEVEL_MAP.items():
        if key in s:
            return level
    return None


def get_fiscal_year(decision_date):
    """DOL fiscal year: Oct 1 - Sep 30. FY2025 = Oct 2024 - Sep 2025."""
    if pd.isna(decision_date):
        return None
    dt = pd.to_datetime(decision_date, errors="coerce")
    if pd.isna(dt):
        return None
    if dt.month >= 10:
        return dt.year + 1
    return dt.year


def normalize_soc_code(val):
    """Clean SOC code: remove dashes and dots, keep 6 or 7 char format."""
    if pd.isna(val):
        return None
    s = str(val).strip()
    # Remove trailing .00 or .XX
    s = s.split(".")[0] if "." in s else s
    # Keep the dash format: "15-1252"
    s = s.strip()
    if len(s) >= 6:
        return s
    return None


class NormalizerAgent:
    def __init__(self, state, file_type="lca"):
        self.state = state
        self.file_type = file_type

    async def run(self):
        input_path = STAGING_DIR / f"{self.file_type}_parsed.parquet"
        console.print(f"  Reading {input_path}...")
        df = pd.read_parquet(input_path)
        initial_rows = len(df)
        review_items = []

        # --- Case Status ---
        status_map = LCA_STATUS_MAP if self.file_type == "lca" else PERM_STATUS_MAP
        if "case_status_raw" in df.columns:
            df["case_status"] = (
                df["case_status_raw"]
                .fillna("")
                .str.strip()
                .str.lower()
                .map(status_map)
            )
            unmapped = df["case_status"].isna().sum()
            if unmapped:
                console.print(f"  [yellow]{unmapped:,} rows with unknown case status[/yellow]")
                # Drop rows with unknown status
                df = df.dropna(subset=["case_status"])

        # --- State Normalization ---
        if "worksite_state_raw" in df.columns:
            df["worksite_state"] = df["worksite_state_raw"].apply(normalize_state)
            null_states = df["worksite_state"].isna().sum()
            if null_states:
                console.print(f"  [yellow]{null_states:,} rows with unresolved worksite state[/yellow]")

        if "employer_state_raw" in df.columns:
            df["employer_state"] = df["employer_state_raw"].apply(normalize_state)

        # --- Wage Normalization ---
        wage_col = "wage_from_raw" if self.file_type == "lca" else "wage_offered_raw"
        unit_col = "wage_unit_raw"
        if wage_col in df.columns:
            df["wage_offered_annual"] = df.apply(
                lambda r: normalize_wage(r.get(wage_col), r.get(unit_col)), axis=1
            )

            # Flag anomalies
            anomaly_mask = (
                (df["wage_offered_annual"].notna())
                & ((df["wage_offered_annual"] < 30000) | (df["wage_offered_annual"] > 1_000_000))
            )
            anomaly_count = anomaly_mask.sum()
            if anomaly_count:
                console.print(f"  [yellow]{anomaly_count:,} wage anomalies (< $30K or > $1M)[/yellow]")
                for _, row in df[anomaly_mask].head(5).iterrows():
                    review_items.append({
                        "type": "wage_anomaly",
                        "case_number": row.get("case_number", ""),
                        "employer": row.get("employer_name", ""),
                        "wage": row["wage_offered_annual"],
                        "raw_wage": row.get(wage_col, ""),
                        "raw_unit": row.get(unit_col, ""),
                    })

        # Prevailing wage normalization
        if "prevailing_wage_raw" in df.columns:
            pw_unit = "wage_unit_raw" if self.file_type == "lca" else "pw_unit_raw"
            df["prevailing_wage"] = df.apply(
                lambda r: normalize_wage(r.get("prevailing_wage_raw"), r.get(pw_unit, r.get("wage_unit_raw"))),
                axis=1,
            )

        # --- Wage Level ---
        if "wage_level_raw" in df.columns:
            df["wage_level"] = df["wage_level_raw"].apply(extract_wage_level)

        # --- SOC Code ---
        if "soc_code_raw" in df.columns:
            df["soc_code"] = df["soc_code_raw"].apply(normalize_soc_code)

        # --- Dates ---
        if "decision_date_raw" in df.columns:
            df["decision_date"] = df["decision_date_raw"].apply(parse_date)
            df["decision_date"] = pd.to_datetime(df["decision_date"], errors="coerce")

        if "employment_start_raw" in df.columns:
            df["employment_start"] = df["employment_start_raw"].apply(parse_date)
            df["employment_start"] = pd.to_datetime(df["employment_start"], errors="coerce")

        if "employment_end_raw" in df.columns:
            df["employment_end"] = df["employment_end_raw"].apply(parse_date)
            df["employment_end"] = pd.to_datetime(df["employment_end"], errors="coerce")

        if "received_date_raw" in df.columns:
            df["received_date"] = df["received_date_raw"].apply(parse_date)
            df["received_date"] = pd.to_datetime(df["received_date"], errors="coerce")

        # --- Fiscal Year & Calendar Year ---
        if "decision_date" in df.columns:
            df["fiscal_year"] = df["decision_date"].apply(get_fiscal_year)
            df["calendar_year"] = df["decision_date"].dt.year

            null_fy = df["fiscal_year"].isna().sum()
            if null_fy:
                console.print(f"  [yellow]{null_fy:,} rows with no fiscal year (no decision date)[/yellow]")

        # --- LCA: visa class normalization ---
        if self.file_type == "lca" and "visa_class" in df.columns:
            # Normalize visa class values
            visa_map = {
                "h-1b": "H-1B",
                "h-1b1 chile": "H-1B1 Chile",
                "h-1b1 singapore": "H-1B1 Singapore",
                "e-3 australian": "E-3",
                "e-3": "E-3",
            }
            df["visa_class"] = df["visa_class"].str.strip().str.lower().map(visa_map).fillna("H-1B")

        # --- PERM: processing days ---
        if self.file_type == "perm":
            if "decision_date" in df.columns and "received_date" in df.columns:
                df["processing_days"] = (df["decision_date"] - df["received_date"]).dt.days

            # Audit detection
            if "fw_education" in df.columns:
                df["was_audited"] = False  # Will be refined if audit columns exist

        # --- Summary stats ---
        clean_rows = len(df)
        console.print(f"  Clean rows: {clean_rows:,} (from {initial_rows:,})")

        if "case_status" in df.columns:
            status_counts = df["case_status"].value_counts().to_dict()
            for status, count in status_counts.items():
                console.print(f"    {status}: {count:,}")

        if "wage_offered_annual" in df.columns:
            valid_wages = df["wage_offered_annual"].dropna()
            if len(valid_wages) > 0:
                console.print(
                    f"  Wage stats: median ${valid_wages.median():,.0f}, "
                    f"mean ${valid_wages.mean():,.0f}, "
                    f"range ${valid_wages.min():,.0f}–${valid_wages.max():,.0f}"
                )

        if "fiscal_year" in df.columns:
            fy_counts = df["fiscal_year"].dropna().value_counts().sort_index()
            console.print(f"  Fiscal years: {dict(fy_counts)}")

        # Save
        output_path = STAGING_DIR / f"{self.file_type}_normalized.parquet"
        df.to_parquet(output_path, index=False)
        console.print(f"  Saved to {output_path}")

        return StageResult(
            summary_text=f"{clean_rows:,} clean rows from {initial_rows:,}",
            stats={
                "initial_rows": initial_rows,
                "clean_rows": clean_rows,
                "dropped": initial_rows - clean_rows,
                "wage_anomalies": len([r for r in review_items if r["type"] == "wage_anomaly"]),
            },
            review_items=review_items,
        )
