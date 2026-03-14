"""
Computes Sponsor Score (0-100) per employer.
Also computes salary benchmarks per SOC per state.

Score formula (weighted):
  approval_rate (30%) — excludes withdrawn
  wage_competitiveness (25%) — avg(offered/prevailing), full-time Level II-III
  perm_conversion (25%) — PERM certified / LCA certified
  consistency (10%) — years with >5 filings out of last 5
  volume_floor (10%) — log-scaled volume

Since we currently have only FY2025 data, consistency and multi-year
trends are limited. The scorer handles single-year gracefully.
"""

import math
import pandas as pd
import numpy as np
from pathlib import Path
from rich.console import Console
from state import StageResult

console = Console()

STAGING_DIR = Path("data/staging")


def score_approval_rate(certified, denied):
    """30% weight. certified / (certified + denied). Withdrawn excluded."""
    total = certified + denied
    if total == 0:
        return 0.5  # neutral
    return certified / total


def score_wage_competitiveness(avg_ratio):
    """25% weight. avg(offered / prevailing).
    >1.20 = 1.0, 1.10-1.20 = 0.8, 1.0-1.10 = 0.6, <1.0 = 0.0
    """
    if pd.isna(avg_ratio) or avg_ratio <= 0:
        return 0.5
    if avg_ratio >= 1.20:
        return 1.0
    if avg_ratio >= 1.10:
        return 0.8
    if avg_ratio >= 1.0:
        return 0.6
    return max(0, avg_ratio - 0.5) * 2  # linear 0.5-1.0 -> 0-1


def score_perm_conversion(rate):
    """25% weight. perm_certified / lca_certified.
    >0.15 = 1.0, 0.05-0.15 = 0.6, 0.01-0.05 = 0.3, <0.01 = 0.0
    """
    if pd.isna(rate) or rate <= 0:
        return 0.0
    if rate >= 0.15:
        return 1.0
    if rate >= 0.05:
        return 0.6
    if rate >= 0.01:
        return 0.3
    return 0.0


def score_consistency(years_active, total_years=5):
    """10% weight. How many of the last N years had >5 filings."""
    return min(years_active / total_years, 1.0)


def score_volume(total_certified, max_volume):
    """10% weight. log-scaled volume."""
    if total_certified <= 0 or max_volume <= 0:
        return 0.0
    return min(math.log10(max(total_certified, 1)) / math.log10(max(max_volume, 10)), 1.0)


def compute_sponsor_score(approval, wage_comp, perm_conv, consistency, volume):
    """Weighted combination, scale to 0-100."""
    raw = (
        0.30 * approval
        + 0.25 * wage_comp
        + 0.25 * perm_conv
        + 0.10 * consistency
        + 0.10 * volume
    )
    return round(raw * 100, 1)


def get_score_tier(score, total_filings):
    if total_filings < 10:
        return "new"
    if score >= 80:
        return "excellent"
    if score >= 60:
        return "good"
    if score >= 40:
        return "fair"
    if score >= 20:
        return "poor"
    return "poor"


def get_gc_pipeline_strength(perm_rate, is_staffing):
    if is_staffing:
        return "staffing"
    if perm_rate >= 0.15:
        return "strong"
    if perm_rate >= 0.05:
        return "moderate"
    if perm_rate >= 0.01:
        return "weak"
    return "none"


class ScorerAgent:
    def __init__(self, state, **kwargs):
        self.state = state

    async def run(self):
        lca_df = pd.read_parquet(STAGING_DIR / "lca_normalized.parquet")
        perm_df = pd.read_parquet(STAGING_DIR / "perm_normalized.parquet")

        console.print(f"  LCA rows: {len(lca_df):,}, PERM rows: {len(perm_df):,}")

        # Filter LCA: exclude amendments for stats
        lca_orig = lca_df[~lca_df.get("is_amendment", pd.Series(False, index=lca_df.index)).fillna(False)].copy()
        console.print(f"  LCA original (non-amendment): {len(lca_orig):,}")

        # --- Sponsor Stats per employer ---
        console.print("  Computing sponsor stats...")

        # LCA stats per employer
        lca_stats = lca_orig.groupby("employer_id").agg(
            lca_total=("case_number", "count"),
            lca_certified=("case_status", lambda x: (x == "certified").sum()),
            lca_denied=("case_status", lambda x: (x == "denied").sum()),
            lca_withdrawn=("case_status", lambda x: (x == "withdrawn").sum()),
            lca_certified_withdrawn=("case_status", lambda x: (x == "certified_withdrawn").sum()),
            total_workers=("total_workers", "sum"),
        ).reset_index()

        # Wage stats: full-time only
        ft_mask = lca_orig["is_full_time"].fillna(True)
        lca_wages = lca_orig[ft_mask & lca_orig["wage_offered_annual"].notna()].groupby("employer_id").agg(
            avg_wage=("wage_offered_annual", "mean"),
            median_wage=("wage_offered_annual", "median"),
            p25_wage=("wage_offered_annual", lambda x: x.quantile(0.25)),
            p75_wage=("wage_offered_annual", lambda x: x.quantile(0.75)),
        ).reset_index()

        # Wage competitiveness: offered / prevailing
        wage_ratio_df = lca_orig[
            ft_mask
            & lca_orig["wage_offered_annual"].notna()
            & lca_orig["prevailing_wage"].notna()
            & (lca_orig["prevailing_wage"] > 0)
        ].copy()
        wage_ratio_df["wage_ratio"] = wage_ratio_df["wage_offered_annual"] / wage_ratio_df["prevailing_wage"]
        wage_ratios = wage_ratio_df.groupby("employer_id")["wage_ratio"].mean().reset_index()
        wage_ratios.columns = ["employer_id", "avg_wage_ratio"]

        # Top job titles per employer
        top_titles = (
            lca_orig.groupby(["employer_id", "job_title_raw"])
            .size()
            .reset_index(name="count")
            .sort_values(["employer_id", "count"], ascending=[True, False])
            .groupby("employer_id")
            .head(5)
            .groupby("employer_id")
            .apply(lambda g: [{"title": r["job_title_raw"], "count": int(r["count"])} for _, r in g.iterrows()])
            .reset_index(name="top_titles")
        )

        # Top worksites per employer
        top_worksites = (
            lca_orig[lca_orig["worksite_state"].notna()]
            .groupby(["employer_id", "worksite_state"])
            .size()
            .reset_index(name="count")
            .sort_values(["employer_id", "count"], ascending=[True, False])
            .groupby("employer_id")
            .head(5)
            .groupby("employer_id")
            .apply(lambda g: [{"state": r["worksite_state"], "count": int(r["count"])} for _, r in g.iterrows()])
            .reset_index(name="top_worksites")
        )

        # PERM stats per employer
        perm_stats = perm_df.groupby("employer_id").agg(
            perm_total=("case_number", "count"),
            perm_certified=("case_status", lambda x: (x == "certified").sum()),
            perm_denied=("case_status", lambda x: (x == "denied").sum()),
            perm_withdrawn=("case_status", lambda x: (x == "withdrawn").sum()),
        ).reset_index()

        # Merge everything
        stats = lca_stats.merge(lca_wages, on="employer_id", how="left")
        stats = stats.merge(wage_ratios, on="employer_id", how="left")
        stats = stats.merge(perm_stats, on="employer_id", how="left")
        stats = stats.merge(top_titles, on="employer_id", how="left")
        stats = stats.merge(top_worksites, on="employer_id", how="left")

        # Fill NaN for PERM stats (employers with no PERM filings)
        for col in ["perm_total", "perm_certified", "perm_denied", "perm_withdrawn"]:
            stats[col] = stats[col].fillna(0).astype(int)

        # Detect staffing companies: >200 LCA but <20 PERM
        stats["is_staffing"] = (stats["lca_total"] > 200) & (stats["perm_total"] < 20)
        staffing_count = stats["is_staffing"].sum()
        console.print(f"  Staffing companies detected: {staffing_count:,}")

        # Compute scores
        console.print("  Computing sponsor scores...")
        max_volume = stats["lca_certified"].max()

        # PERM conversion rate
        stats["perm_conversion_rate"] = np.where(
            stats["lca_certified"] > 0,
            stats["perm_certified"] / stats["lca_certified"],
            0,
        )

        # Approval rate
        stats["lca_approval_rate"] = stats.apply(
            lambda r: score_approval_rate(r["lca_certified"], r["lca_denied"]),
            axis=1,
        )

        # GC pipeline strength
        stats["gc_pipeline_strength"] = stats.apply(
            lambda r: get_gc_pipeline_strength(r["perm_conversion_rate"], r["is_staffing"]),
            axis=1,
        )

        # Score components
        stats["sc_approval"] = stats["lca_approval_rate"]
        stats["sc_wage"] = stats["avg_wage_ratio"].apply(score_wage_competitiveness)
        stats["sc_perm"] = stats["perm_conversion_rate"].apply(score_perm_conversion)
        stats["sc_consistency"] = 1.0  # only 1 year of data for now
        stats["sc_volume"] = stats["lca_certified"].apply(lambda x: score_volume(x, max_volume))

        stats["sponsor_score"] = stats.apply(
            lambda r: compute_sponsor_score(
                r["sc_approval"], r["sc_wage"], r["sc_perm"],
                r["sc_consistency"], r["sc_volume"],
            ),
            axis=1,
        )

        stats["score_tier"] = stats.apply(
            lambda r: get_score_tier(r["sponsor_score"], r["lca_total"]),
            axis=1,
        )

        # Score breakdown JSON
        stats["score_breakdown"] = stats.apply(
            lambda r: {
                "approval_rate": {"score": round(r["sc_approval"] * 100, 1), "weight": 30},
                "wage_competitiveness": {"score": round(r["sc_wage"] * 100, 1), "weight": 25},
                "perm_conversion": {"score": round(r["sc_perm"] * 100, 1), "weight": 25},
                "consistency": {"score": round(r["sc_consistency"] * 100, 1), "weight": 10},
                "volume": {"score": round(r["sc_volume"] * 100, 1), "weight": 10},
            },
            axis=1,
        )

        # Add fiscal year
        stats["fiscal_year"] = 2025

        # Summary
        tier_counts = stats["score_tier"].value_counts()
        console.print("  Score distribution:")
        for tier, count in tier_counts.items():
            console.print(f"    {tier}: {count:,}")

        console.print(f"  Median score: {stats['sponsor_score'].median():.1f}")
        console.print(f"  Mean score: {stats['sponsor_score'].mean():.1f}")

        # Top employers
        top = stats.nlargest(10, "sponsor_score")[["employer_id", "sponsor_score", "lca_total", "perm_total", "score_tier"]]
        console.print("  Top 10 by score:")
        # Get canonical names
        emp_df = pd.read_parquet(STAGING_DIR / "employers.parquet")
        emp_names = dict(zip(emp_df["employer_id"], emp_df["canonical_name"]))
        for _, r in top.iterrows():
            name = emp_names.get(r["employer_id"], "?")
            console.print(f"    {name}: {r['sponsor_score']} ({r['score_tier']}) - LCA:{r['lca_total']:,} PERM:{r['perm_total']:,}")

        # Save
        stats.to_parquet(STAGING_DIR / "sponsor_stats.parquet", index=False)
        console.print(f"  Saved sponsor_stats.parquet ({len(stats):,} employers)")

        # --- Salary Benchmarks ---
        console.print("  Computing salary benchmarks...")
        bench_df = lca_orig[
            lca_orig["is_full_time"].fillna(True)
            & lca_orig["wage_offered_annual"].notna()
            & (lca_orig["wage_offered_annual"] >= 30000)
            & (lca_orig["wage_offered_annual"] <= 1_000_000)
            & lca_orig["soc_code"].notna()
            & lca_orig["worksite_state"].notna()
        ].copy()

        benchmarks = bench_df.groupby(["soc_code", "worksite_state"]).agg(
            sample_size=("wage_offered_annual", "count"),
            p10_wage=("wage_offered_annual", lambda x: x.quantile(0.10)),
            p25_wage=("wage_offered_annual", lambda x: x.quantile(0.25)),
            p50_wage=("wage_offered_annual", lambda x: x.quantile(0.50)),
            p75_wage=("wage_offered_annual", lambda x: x.quantile(0.75)),
            p90_wage=("wage_offered_annual", lambda x: x.quantile(0.90)),
            avg_wage=("wage_offered_annual", "mean"),
        ).reset_index()

        # Only keep benchmarks with >= 5 data points
        benchmarks = benchmarks[benchmarks["sample_size"] >= 5]
        benchmarks["fiscal_year"] = 2025

        benchmarks.to_parquet(STAGING_DIR / "salary_benchmarks.parquet", index=False)
        console.print(f"  Saved salary_benchmarks.parquet ({len(benchmarks):,} benchmarks)")

        return StageResult(
            summary_text=f"{len(stats):,} employer scores, {len(benchmarks):,} salary benchmarks",
            stats={
                "employers_scored": len(stats),
                "salary_benchmarks": len(benchmarks),
                "staffing_detected": int(staffing_count),
                "median_score": float(stats["sponsor_score"].median()),
            },
        )
