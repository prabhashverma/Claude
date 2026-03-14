export interface LCAFiling {
  case_number: string;
  case_status: string;
  employer_id: string;
  employer_name: string;
  employer_name_canonical: string;
  job_title_raw: string;
  soc_code: string | null;
  soc_title_raw: string | null;
  wage_level: number | null;
  visa_class: string;
  is_amendment: boolean;
  is_full_time: boolean;
  total_workers: number;
  wage_offered_annual: number | null;
  prevailing_wage: number | null;
  worksite_city: string | null;
  worksite_state: string | null;
  fiscal_year: number;
  decision_date: string | null;
}

export interface PERMFiling {
  case_number: string;
  case_status: string;
  employer_id: string;
  employer_name: string;
  employer_name_canonical: string;
  job_title_raw: string;
  soc_code: string | null;
  wage_offered_annual: number | null;
  prevailing_wage: number | null;
  worksite_city: string | null;
  worksite_state: string | null;
  worker_citizenship: string | null;
  fiscal_year: number;
  decision_date: string | null;
  processing_days: number | null;
}

export interface Employer {
  employer_id: string;
  canonical_name: string;
}

export interface SponsorStats {
  employer_id: string;
  fiscal_year: number;
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
  score_breakdown: Record<string, { score: number; weight: number }>;
  gc_pipeline_strength: string;
  perm_conversion_rate: number;
  top_titles: { title: string; count: number }[];
  top_worksites: { state: string; count: number }[];
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

export interface SearchParams {
  employer?: string;
  title?: string;
  state?: string;
  year?: number;
  visa_class?: string;
  wage_min?: number;
  wage_max?: number;
  status?: string;
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}
