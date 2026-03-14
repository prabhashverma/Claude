"""
Parses raw DOL xlsx files into clean parquet.
Detects column names dynamically, flags amendments, validates structure.
"""

import pandas as pd
from pathlib import Path
from rich.console import Console
from state import StageResult

console = Console()

STAGING_DIR = Path("data/staging")

# Map raw DOL column names to canonical names (handles year-to-year variation)
LCA_COLUMN_MAP = {
    # Employer
    "EMPLOYER_NAME": "employer_name",
    # SOC
    "SOC_CODE": "soc_code_raw",
    "SOC_CD": "soc_code_raw",
    "SOC_TITLE": "soc_title_raw",
    "SOC_OCCUPATIONAL_TITLE": "soc_title_raw",
    # Job
    "JOB_TITLE": "job_title_raw",
    "FULL_TIME_POSITION": "is_full_time_raw",
    # Visa
    "VISA_CLASS": "visa_class_raw",
    # Workers
    "TOTAL_WORKERS": "total_workers",
    "TOTAL_WORKER_POSITIONS": "total_workers",
    # Wages
    "WAGE_RATE_OF_PAY_FROM": "wage_from_raw",
    "WAGE_RATE_OF_PAY_FROM_1": "wage_from_raw",
    "WAGE_RATE_OF_PAY_TO": "wage_to_raw",
    "WAGE_RATE_OF_PAY_TO_1": "wage_to_raw",
    "WAGE_UNIT_OF_PAY": "wage_unit_raw",
    "WAGE_UNIT_OF_PAY_1": "wage_unit_raw",
    "PREVAILING_WAGE": "prevailing_wage_raw",
    "PREVAILING_WAGE_1": "prevailing_wage_raw",
    "PW_WAGE_LEVEL": "wage_level_raw",
    "PW_WAGE_LEVEL_1": "wage_level_raw",
    # Location (worksite, NOT HQ)
    "WORKSITE_CITY": "worksite_city",
    "WORKSITE_CITY_1": "worksite_city",
    "WORKSITE_STATE": "worksite_state_raw",
    "WORKSITE_STATE_1": "worksite_state_raw",
    "WORKSITE_POSTAL_CODE": "worksite_postal",
    "WORKSITE_POSTAL_CODE_1": "worksite_postal",
    # Employer HQ (stored but NOT used for location features)
    "EMPLOYER_CITY": "employer_city",
    "EMPLOYER_STATE": "employer_state_raw",
    # Dates
    "DECISION_DATE": "decision_date_raw",
    "BEGIN_DATE": "employment_start_raw",
    "END_DATE": "employment_end_raw",
    "RECEIVED_DATE": "received_date_raw",
    # Case
    "CASE_NUMBER": "case_number",
    "CASE_STATUS": "case_status_raw",
    # Amendment flag
    "AMENDED_PETITION": "amended_petition",
    # Employment type
    "NEW_EMPLOYMENT": "new_employment",
    "CONTINUED_EMPLOYMENT": "continued_employment",
    "CHANGE_PREVIOUS_EMPLOYMENT": "change_previous_employment",
    "CHANGE_EMPLOYER": "change_employer",
    "NEW_CONCURRENT_EMPLOYMENT": "new_concurrent_employment",
    # NAICS
    "NAICS_CODE": "naics_code",
}

PERM_COLUMN_MAP = {
    # Case
    "CASE_NUMBER": "case_number",
    "CASE_NO": "case_number",
    "CASE_STATUS": "case_status_raw",
    "DECISION_DATE": "decision_date_raw",
    "RECEIVED_DATE": "received_date_raw",
    "CASE_RECEIVED_DATE": "received_date_raw",
    # Employer (FY2025 uses EMP_ prefix)
    "EMP_BUSINESS_NAME": "employer_name",
    "EMPLOYER_NAME": "employer_name",
    "EMP_CITY": "employer_city",
    "EMPLOYER_CITY": "employer_city",
    "EMP_STATE": "employer_state_raw",
    "EMPLOYER_STATE": "employer_state_raw",
    "EMP_POSTCODE": "employer_postal",
    "EMP_FEIN": "employer_fein",
    "EMP_NUM_PAYROLL": "employer_num_employees",
    "EMPLOYER_NUM_EMPLOYEES": "employer_num_employees",
    "EMP_YEAR_COMMENCED": "employer_yr_estab",
    "EMPLOYER_YR_ESTAB": "employer_yr_estab",
    "EMP_NAICS": "naics_code",
    "NAICS_CODE": "naics_code",
    "EMP_TRADE_NAME": "employer_trade_name",
    # Job
    "JOB_TITLE": "job_title_raw",
    "JOB_INFO_JOB_TITLE": "job_title_raw",
    "OCCUPATION_TYPE": "occupation_type",
    # SOC
    "PWD_SOC_CODE": "soc_code_raw",
    "PW_SOC_CODE": "soc_code_raw",
    "PWD_SOC_TITLE": "soc_title_raw",
    "PW_SOC_TITLE": "soc_title_raw",
    # Wages (FY2025 uses JOB_OPP_ prefix)
    "JOB_OPP_WAGE_FROM": "wage_offered_raw",
    "WAGE_OFFER_FROM_9089": "wage_offered_raw",
    "JOB_OPP_WAGE_TO": "wage_offered_to_raw",
    "JOB_OPP_WAGE_PER": "wage_unit_raw",
    "WAGE_OFFER_UNIT_OF_PAY_9089": "wage_unit_raw",
    "JOB_OPP_PWD_NUMBER": "pwd_tracking_number",
    # Location (FY2025 uses PRIMARY_WORKSITE_ prefix)
    "PRIMARY_WORKSITE_CITY": "worksite_city",
    "WORKSITE_CITY": "worksite_city",
    "PRIMARY_WORKSITE_STATE": "worksite_state_raw",
    "WORKSITE_STATE": "worksite_state_raw",
    "PRIMARY_WORKSITE_POSTAL_CODE": "worksite_postal",
    "WORKSITE_POSTAL_CODE": "worksite_postal",
    "PRIMARY_WORKSITE_COUNTY": "worksite_county",
    # Foreign worker info
    "FW_INFO_APPX_A_ATTACHED": "fw_education",
    "FOREIGN_WORKER_INFO_EDUCATION": "fw_education",
    "FW_INFO_BIRTH_COUNTRY": "fw_birth_country",
    "COUNTRY_OF_CITIZENSHIP": "worker_citizenship",
    "CLASS_OF_ADMISSION": "class_of_admission",
    # Multiple locations
    "IS_MULTIPLE_LOCATIONS": "is_multiple_locations",
    # Full time
    "OTHER_REQ_IS_FULLTIME_EMP": "is_full_time_raw",
}

# Columns we absolutely need for each file type
LCA_REQUIRED = {"case_number", "employer_name", "case_status_raw"}
PERM_REQUIRED = {"case_number", "employer_name", "case_status_raw"}


class ParserAgent:
    def __init__(self, state, file_type="lca"):
        self.state = state
        self.file_type = file_type
        self.file_path = state.lca_file if file_type == "lca" else state.perm_file

    async def run(self):
        console.print(f"  Reading {self.file_path}...")
        STAGING_DIR.mkdir(parents=True, exist_ok=True)

        # Read xlsx
        df = pd.read_excel(self.file_path, engine="openpyxl")
        raw_rows = len(df)
        console.print(f"  Raw rows: {raw_rows:,}")
        console.print(f"  Raw columns: {len(df.columns)}")

        # Normalize column names to uppercase for matching
        df.columns = [c.strip().upper() for c in df.columns]

        # Map columns
        col_map = LCA_COLUMN_MAP if self.file_type == "lca" else PERM_COLUMN_MAP
        required = LCA_REQUIRED if self.file_type == "lca" else PERM_REQUIRED

        rename = {}
        matched = []
        unmatched = []
        for raw_col in df.columns:
            if raw_col in col_map:
                rename[raw_col] = col_map[raw_col]
                matched.append(raw_col)
            else:
                unmatched.append(raw_col)

        console.print(f"  Matched {len(matched)}/{len(df.columns)} columns")
        if unmatched:
            console.print(
                f"  [dim]Unmatched: {', '.join(unmatched[:10])}{'...' if len(unmatched) > 10 else ''}[/dim]"
            )

        df = df.rename(columns=rename)

        # Keep only mapped columns
        keep_cols = [c for c in df.columns if c in col_map.values()]
        df = df[keep_cols]

        # Validate required columns present
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"Missing required columns: {missing}")

        # LCA-specific: detect amendments and clean visa_class
        if self.file_type == "lca":
            # Amendment detection: check dedicated column first, then visa_class text
            if "amended_petition" in df.columns:
                df["is_amendment"] = pd.to_numeric(df["amended_petition"], errors="coerce").fillna(0).astype(bool)
            elif "visa_class_raw" in df.columns:
                df["is_amendment"] = (
                    df["visa_class_raw"]
                    .fillna("")
                    .str.contains("Amendment", case=False)
                )
            else:
                df["is_amendment"] = False

            amendment_count = df["is_amendment"].sum()
            console.print(f"  Amendments flagged: {amendment_count:,}")

            # Visa class
            if "visa_class_raw" in df.columns:
                df["visa_class"] = (
                    df["visa_class_raw"]
                    .fillna("")
                    .str.replace(r"\s*Amendment\s*", "", regex=True)
                    .str.strip()
                )
            else:
                df["visa_class"] = "H-1B"

            # Full-time flag
            if "is_full_time_raw" in df.columns:
                df["is_full_time"] = df["is_full_time_raw"].fillna("Y").str.upper().str.startswith("Y")
            else:
                df["is_full_time"] = True

            # Total workers default
            if "total_workers" in df.columns:
                df["total_workers"] = pd.to_numeric(df["total_workers"], errors="coerce").fillna(1).astype(int)
            else:
                df["total_workers"] = 1

        # PERM-specific: detect person-specific filings
        if self.file_type == "perm":
            df["is_person_specific"] = df.get("fw_education", pd.Series(dtype=str)).notna()

            if "was_refiled" in df.columns:
                df["was_refiled"] = df["was_refiled"].fillna("N").str.upper().str.startswith("Y")
            else:
                df["was_refiled"] = False

        # Drop rows with no case number
        before = len(df)
        df = df.dropna(subset=["case_number"])
        dropped = before - len(df)
        if dropped:
            console.print(f"  [yellow]Dropped {dropped:,} rows with no case_number[/yellow]")

        # Drop duplicate case numbers (keep first)
        before = len(df)
        df = df.drop_duplicates(subset=["case_number"], keep="first")
        dupes = before - len(df)
        if dupes:
            console.print(f"  [yellow]Dropped {dupes:,} duplicate case numbers[/yellow]")

        # Coerce mixed-type object columns to string before parquet
        for col in df.select_dtypes(include=["object"]).columns:
            df[col] = df[col].astype(str).replace("nan", pd.NA).replace("None", pd.NA)

        # Save to parquet
        output_path = STAGING_DIR / f"{self.file_type}_parsed.parquet"
        df.to_parquet(output_path, index=False)
        console.print(f"  Saved to {output_path} ({len(df):,} rows)")

        return StageResult(
            summary_text=f"{len(df):,} rows parsed from {raw_rows:,} raw",
            stats={
                "raw_rows": raw_rows,
                "parsed_rows": len(df),
                "columns_matched": len(matched),
                "columns_unmatched": len(unmatched),
            },
        )
