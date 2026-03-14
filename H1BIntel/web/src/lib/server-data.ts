import { readFileSync } from "fs";
import { join } from "path";

let lcaData: any[] | null = null;
let permData: any[] | null = null;

function loadLCA() {
  if (!lcaData) {
    const raw = readFileSync(join(process.cwd(), "src/data/lca.json"), "utf-8");
    lcaData = JSON.parse(raw);
  }
  return lcaData!;
}

function loadPERM() {
  if (!permData) {
    const raw = readFileSync(join(process.cwd(), "src/data/perm.json"), "utf-8");
    permData = JSON.parse(raw);
  }
  return permData!;
}

export interface LCASearchParams {
  employer?: string;
  title?: string;
  state?: string;
  visa_class?: string;
  wage_min?: number;
  wage_max?: number;
  status?: string;
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_dir?: string;
}

export function searchLCA(params: LCASearchParams) {
  let data = loadLCA();

  // Filter
  if (params.employer) {
    const q = params.employer.toLowerCase();
    data = data.filter(
      (r) => r.employer_name_canonical?.toLowerCase().includes(q)
    );
  }
  if (params.title) {
    const q = params.title.toLowerCase();
    data = data.filter((r) => r.job_title_raw?.toLowerCase().includes(q));
  }
  if (params.state) {
    data = data.filter((r) => r.worksite_state === params.state);
  }
  if (params.visa_class) {
    data = data.filter((r) => r.visa_class === params.visa_class);
  }
  if (params.status) {
    data = data.filter((r) => r.case_status === params.status);
  }
  if (params.wage_min) {
    data = data.filter(
      (r) => r.wage_offered_annual && r.wage_offered_annual >= params.wage_min!
    );
  }
  if (params.wage_max) {
    data = data.filter(
      (r) => r.wage_offered_annual && r.wage_offered_annual <= params.wage_max!
    );
  }

  const total = data.length;

  // Sort
  const sortBy = params.sort_by || "wage_offered_annual";
  const sortDir = params.sort_dir === "asc" ? 1 : -1;
  data.sort((a, b) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir;
  });

  // Paginate
  const page = params.page || 1;
  const perPage = Math.min(params.per_page || 50, 100);
  const start = (page - 1) * perPage;
  const results = data.slice(start, start + perPage);

  return { total, page, per_page: perPage, results };
}

export interface PERMSearchParams {
  employer?: string;
  title?: string;
  state?: string;
  citizenship?: string;
  status?: string;
  wage_min?: number;
  wage_max?: number;
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_dir?: string;
}

export function searchPERM(params: PERMSearchParams) {
  let data = loadPERM();

  if (params.employer) {
    const q = params.employer.toLowerCase();
    data = data.filter(
      (r) => r.employer_name_canonical?.toLowerCase().includes(q)
    );
  }
  if (params.title) {
    const q = params.title.toLowerCase();
    data = data.filter((r) => r.job_title_raw?.toLowerCase().includes(q));
  }
  if (params.state) {
    data = data.filter((r) => r.worksite_state === params.state);
  }
  if (params.citizenship) {
    const q = params.citizenship.toLowerCase();
    data = data.filter(
      (r) => r.worker_citizenship?.toLowerCase().includes(q)
    );
  }
  if (params.status) {
    data = data.filter((r) => r.case_status === params.status);
  }
  if (params.wage_min) {
    data = data.filter(
      (r) => r.wage_offered_annual && r.wage_offered_annual >= params.wage_min!
    );
  }
  if (params.wage_max) {
    data = data.filter(
      (r) => r.wage_offered_annual && r.wage_offered_annual <= params.wage_max!
    );
  }

  const total = data.length;

  const sortBy = params.sort_by || "wage_offered_annual";
  const sortDir = params.sort_dir === "asc" ? 1 : -1;
  data.sort((a, b) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir;
  });

  const page = params.page || 1;
  const perPage = Math.min(params.per_page || 50, 100);
  const start = (page - 1) * perPage;
  const results = data.slice(start, start + perPage);

  return { total, page, per_page: perPage, results };
}
