import sponsorStatsData from "../data/sponsor_stats.json";
import employersData from "../data/employers.json";
import salaryBenchmarksData from "../data/salary_benchmarks.json";

export interface SponsorStat {
  employer_id: string;
  canonical_name: string;
  lca_total: number;
  lca_certified: number;
  lca_denied: number;
  lca_withdrawn: number;
  lca_approval_rate: number;
  perm_total: number;
  perm_certified: number;
  total_workers: number;
  avg_wage: number | null;
  median_wage: number | null;
  sponsor_score: number;
  score_tier: string;
  gc_pipeline_strength: string;
  perm_conversion_rate: number;
  top_titles: { title: string; count: number }[] | null;
  top_worksites: { state: string; count: number }[] | null;
  score_breakdown: Record<string, { score: number; weight: number }> | null;
  fiscal_year: number;
}

export interface Employer {
  employer_id: string;
  canonical_name: string;
}

export interface SalaryBenchmark {
  soc_code: string;
  worksite_state: string;
  fiscal_year: number;
  sample_size: number;
  p10_wage: number;
  p25_wage: number;
  p50_wage: number;
  p75_wage: number;
  p90_wage: number;
  avg_wage: number;
}

const sponsors = sponsorStatsData as SponsorStat[];
const employers = employersData as Employer[];
const benchmarks = salaryBenchmarksData as SalaryBenchmark[];

export function getTopSponsors(limit = 20): SponsorStat[] {
  return sponsors
    .filter((s) => s.score_tier !== "new")
    .sort((a, b) => b.sponsor_score - a.sponsor_score)
    .slice(0, limit);
}

export function searchSponsors(query: string, limit = 50): SponsorStat[] {
  const q = query.toLowerCase();
  return sponsors
    .filter((s) => s.canonical_name?.toLowerCase().includes(q))
    .sort((a, b) => b.lca_total - a.lca_total)
    .slice(0, limit);
}

export function getSponsorById(employerId: string): SponsorStat | undefined {
  return sponsors.find((s) => s.employer_id === employerId);
}

export function searchEmployers(query: string, limit = 10): Employer[] {
  const q = query.toLowerCase();
  return employers
    .filter((e) => e.canonical_name?.toLowerCase().includes(q))
    .slice(0, limit);
}

export function getHomeStats() {
  const totalLca = sponsors.reduce((sum, s) => sum + s.lca_total, 0);
  const totalPerm = sponsors.reduce((sum, s) => sum + s.perm_total, 0);
  const totalEmployers = sponsors.length;
  const scoredEmployers = sponsors.filter((s) => s.score_tier !== "new").length;
  return { totalLca, totalPerm, totalEmployers, scoredEmployers };
}

export function getAllSponsors(): SponsorStat[] {
  return sponsors;
}

export function getSalaryBenchmarks(
  socCode: string,
  state?: string
): SalaryBenchmark[] {
  return benchmarks.filter(
    (b) => b.soc_code === socCode && (!state || b.worksite_state === state)
  );
}
