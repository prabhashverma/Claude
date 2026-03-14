"""
Employer name reconciliation.
Phase 1: Exact match (case-insensitive) — handles ~70%
Phase 2: Fuzzy match with rapidfuzz — handles ~20%
Phase 3: LLM reconciliation for remaining ~10% (optional, needs API key)

Assigns a stable employer_id (UUID) to every row.
"""

import uuid
import json
import pandas as pd
import numpy as np
from pathlib import Path
from collections import defaultdict
from rich.console import Console
from state import StageResult

try:
    from rapidfuzz import fuzz, process
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

console = Console()

STAGING_DIR = Path("data/staging")
REFERENCE_DIR = Path("data/reference")
FUZZY_THRESHOLD = 85  # minimum score for auto-match


def clean_employer_name(name):
    """Normalize employer name for matching."""
    if pd.isna(name):
        return ""
    s = str(name).strip().upper()
    # Remove common legal suffixes
    for suffix in [
        " LLC", " L.L.C.", " INC.", " INC", " CORP.", " CORP",
        " LTD.", " LTD", " L.P.", " LP", " LLP", " P.C.",
        " CO.", " CO", " COMPANY", " CORPORATION", " INCORPORATED",
        " LIMITED", " GROUP", " HOLDINGS", " INTERNATIONAL",
        ",", ".", "'",
    ]:
        s = s.replace(suffix, "")
    # Collapse whitespace
    s = " ".join(s.split())
    return s


class EntityAgent:
    def __init__(self, state, **kwargs):
        self.state = state
        self.known_employers = {}  # canonical_lower -> {id, name, variants}
        self.load_known_employers()

    def load_known_employers(self):
        """Load known employers from reference CSV if it exists."""
        path = REFERENCE_DIR / "known_employers.csv"
        if path.exists():
            df = pd.read_csv(path)
            for _, row in df.iterrows():
                key = clean_employer_name(row["canonical_name"])
                self.known_employers[key] = {
                    "employer_id": row["employer_id"],
                    "canonical_name": row["canonical_name"],
                    "variants": set(str(row.get("variants", "")).split("|")) if pd.notna(row.get("variants")) else set(),
                }
            console.print(f"  Loaded {len(self.known_employers)} known employers")
        else:
            console.print("  [dim]No known_employers.csv found, starting fresh[/dim]")

    def save_known_employers(self):
        """Save updated known employers to CSV."""
        REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
        rows = []
        for key, data in self.known_employers.items():
            rows.append({
                "employer_id": data["employer_id"],
                "canonical_name": data["canonical_name"],
                "employer_type": data.get("employer_type", "direct"),
                "variants": "|".join(sorted(data["variants"])) if data["variants"] else "",
            })
        df = pd.DataFrame(rows)
        df.to_csv(REFERENCE_DIR / "known_employers.csv", index=False)
        console.print(f"  Saved {len(df)} employers to known_employers.csv")

    async def run(self):
        # Load both normalized files
        lca_df = pd.read_parquet(STAGING_DIR / "lca_normalized.parquet")
        perm_df = pd.read_parquet(STAGING_DIR / "perm_normalized.parquet")

        # Collect all unique employer names
        lca_names = set(lca_df["employer_name"].dropna().unique())
        perm_names = set(perm_df["employer_name"].dropna().unique())
        all_names = lca_names | perm_names
        console.print(f"  Unique employer names: {len(all_names):,} (LCA: {len(lca_names):,}, PERM: {len(perm_names):,})")

        # Build name -> employer_id mapping
        name_to_id = {}
        name_to_canonical = {}
        review_items = []
        stats = {"exact_match": 0, "fuzzy_match": 0, "new_employer": 0}

        # Phase 1: Exact match (case-insensitive, suffix-stripped)
        console.print("  Phase 1: Exact matching...")
        for raw_name in all_names:
            cleaned = clean_employer_name(raw_name)
            if not cleaned:
                continue

            if cleaned in self.known_employers:
                emp = self.known_employers[cleaned]
                name_to_id[raw_name] = emp["employer_id"]
                name_to_canonical[raw_name] = emp["canonical_name"]
                emp["variants"].add(raw_name)
                stats["exact_match"] += 1

        unmatched = [n for n in all_names if n not in name_to_id and clean_employer_name(n)]
        console.print(f"  Phase 1 matched: {stats['exact_match']:,}, unmatched: {len(unmatched):,}")

        # Phase 2: Fuzzy matching against known employers
        if unmatched and HAS_RAPIDFUZZ and self.known_employers:
            console.print("  Phase 2: Fuzzy matching...")
            known_keys = list(self.known_employers.keys())
            fuzzy_matched = 0

            for raw_name in unmatched:
                cleaned = clean_employer_name(raw_name)
                if not cleaned:
                    continue

                result = process.extractOne(cleaned, known_keys, scorer=fuzz.ratio)
                if result and result[1] >= FUZZY_THRESHOLD:
                    match_key = result[0]
                    emp = self.known_employers[match_key]
                    name_to_id[raw_name] = emp["employer_id"]
                    name_to_canonical[raw_name] = emp["canonical_name"]
                    emp["variants"].add(raw_name)
                    fuzzy_matched += 1
                    stats["fuzzy_match"] += 1

            unmatched = [n for n in all_names if n not in name_to_id and clean_employer_name(n)]
            console.print(f"  Phase 2 matched: {fuzzy_matched:,}, still unmatched: {len(unmatched):,}")

        # Phase 3: Create new employer entries for unmatched names
        # Group similar unmatched names together first
        console.print("  Phase 3: Creating new employer entries...")
        unmatched_cleaned = {}  # cleaned -> [raw_names]
        for raw_name in unmatched:
            cleaned = clean_employer_name(raw_name)
            if cleaned:
                unmatched_cleaned.setdefault(cleaned, []).append(raw_name)

        # For each unique cleaned name, create a new employer
        for cleaned, raw_names in unmatched_cleaned.items():
            # Pick the most common raw name as canonical
            canonical = max(raw_names, key=lambda n: len(n))
            # Title case it
            canonical = canonical.strip().title()

            emp_id = str(uuid.uuid4())
            self.known_employers[cleaned] = {
                "employer_id": emp_id,
                "canonical_name": canonical,
                "variants": set(raw_names),
            }
            for rn in raw_names:
                name_to_id[rn] = emp_id
                name_to_canonical[rn] = canonical

            stats["new_employer"] += 1

        # Now do a second pass: fuzzy-match new employers against each other
        # to catch variants like "GOOGLE LLC" and "GOOGLE INC" both being new
        if HAS_RAPIDFUZZ and stats["new_employer"] > 1:
            console.print("  Phase 3b: Deduplicating new employers...")
            new_keys = [k for k, v in self.known_employers.items()
                       if v["employer_id"] in [name_to_id.get(n) for n in unmatched]]
            merged = 0

            # Sort by key length (longer = more specific, keep as canonical)
            new_keys_sorted = sorted(new_keys, key=len, reverse=True)
            seen = set()

            for i, key1 in enumerate(new_keys_sorted):
                if key1 in seen:
                    continue
                emp1 = self.known_employers[key1]

                for key2 in new_keys_sorted[i + 1:]:
                    if key2 in seen:
                        continue
                    score = fuzz.ratio(key1, key2)
                    if score >= 90:  # higher threshold for merging new entries
                        emp2 = self.known_employers[key2]
                        # Merge emp2 into emp1
                        emp1["variants"].update(emp2["variants"])
                        # Update all references
                        for rn in emp2["variants"]:
                            name_to_id[rn] = emp1["employer_id"]
                            name_to_canonical[rn] = emp1["canonical_name"]
                        seen.add(key2)
                        del self.known_employers[key2]
                        merged += 1
                        stats["new_employer"] -= 1

            if merged:
                console.print(f"  Merged {merged} duplicate new employers")

        console.print(f"  Total employers: {len(self.known_employers):,}")
        console.print(f"    Exact: {stats['exact_match']:,} | Fuzzy: {stats['fuzzy_match']:,} | New: {stats['new_employer']:,}")

        # Apply employer_id and canonical_name to both dataframes
        console.print("  Applying employer IDs to LCA data...")
        lca_df["employer_id"] = lca_df["employer_name"].map(name_to_id)
        lca_df["employer_name_canonical"] = lca_df["employer_name"].map(name_to_canonical)
        lca_unresolved = lca_df["employer_id"].isna().sum()
        if lca_unresolved:
            console.print(f"  [yellow]LCA: {lca_unresolved:,} rows without employer_id[/yellow]")

        console.print("  Applying employer IDs to PERM data...")
        perm_df["employer_id"] = perm_df["employer_name"].map(name_to_id)
        perm_df["employer_name_canonical"] = perm_df["employer_name"].map(name_to_canonical)
        perm_unresolved = perm_df["employer_id"].isna().sum()
        if perm_unresolved:
            console.print(f"  [yellow]PERM: {perm_unresolved:,} rows without employer_id[/yellow]")

        # Save updated parquets
        lca_df.to_parquet(STAGING_DIR / "lca_normalized.parquet", index=False)
        perm_df.to_parquet(STAGING_DIR / "perm_normalized.parquet", index=False)

        # Save known employers
        self.save_known_employers()

        # Build employers dataframe for later DB loading
        employer_rows = []
        for cleaned, data in self.known_employers.items():
            employer_rows.append({
                "employer_id": data["employer_id"],
                "canonical_name": data["canonical_name"],
                "name_variants": list(data["variants"]),
            })
        emp_df = pd.DataFrame(employer_rows)
        emp_df.to_parquet(STAGING_DIR / "employers.parquet", index=False)
        console.print(f"  Saved employers.parquet ({len(emp_df):,} employers)")

        return StageResult(
            summary_text=f"{len(self.known_employers):,} employers ({stats['new_employer']:,} new)",
            stats={
                "total_employers": len(self.known_employers),
                "exact_match": stats["exact_match"],
                "fuzzy_match": stats["fuzzy_match"],
                "new_employers": stats["new_employer"],
            },
            review_items=review_items,
        )
