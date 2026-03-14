"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const STATES = [
  "","AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
  "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
  "TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

interface Filing {
  case_number: string;
  case_status: string;
  employer_name_canonical: string;
  employer_id: string;
  job_title_raw: string;
  soc_title_raw: string | null;
  visa_class: string;
  wage_offered_annual: number | null;
  prevailing_wage: number | null;
  wage_level: number | null;
  worksite_city: string | null;
  worksite_state: string | null;
  is_amendment: boolean;
  total_workers: number;
  fiscal_year: number;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    certified: "bg-green-100 text-green-700",
    denied: "bg-red-100 text-red-700",
    withdrawn: "bg-gray-100 text-gray-600",
    certified_withdrawn: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-500"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function formatWage(w: number | null) {
  if (w == null) return "—";
  return `$${Math.round(w).toLocaleString()}`;
}

function wageDelta(offered: number | null, prevailing: number | null) {
  if (!offered || !prevailing || prevailing === 0) return null;
  const pct = ((offered - prevailing) / prevailing) * 100;
  return pct;
}

export default function LCAPage() {
  const [employer, setEmployer] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState("wage_offered_annual");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Filing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async (p = 1) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (employer) params.set("employer", employer);
    if (title) params.set("title", title);
    if (state) params.set("state", state);
    if (status) params.set("status", status);
    params.set("page", String(p));
    params.set("per_page", "50");
    params.set("sort_by", sortBy);
    params.set("sort_dir", sortDir);

    const res = await fetch(`/api/lca?${params}`);
    const data = await res.json();
    setResults(data.results);
    setTotal(data.total);
    setPage(p);
    setLoading(false);
  }, [employer, title, state, status, sortBy, sortDir]);

  useEffect(() => {
    doSearch(1);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">LCA Search</h1>
      <p className="text-sm text-gray-500 mb-6">
        Search H-1B, H-1B1, and E-3 labor condition applications. FY2025 data.
      </p>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <input
          type="text"
          placeholder="Company name..."
          value={employer}
          onChange={(e) => setEmployer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch(1)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
        />
        <input
          type="text"
          placeholder="Job title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch(1)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
        />
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All States</option>
          {STATES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Statuses</option>
          <option value="certified">Certified</option>
          <option value="denied">Denied</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="certified_withdrawn">Certified-Withdrawn</option>
        </select>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => doSearch(1)}
          className="px-5 py-2 bg-[#1B4FD8] text-white rounded-lg text-sm font-medium hover:bg-[#1640B0] transition-colors"
        >
          Search
        </button>
        <select
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [sb, sd] = e.target.value.split(":");
            setSortBy(sb);
            setSortDir(sd);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="wage_offered_annual:desc">Wage: High to Low</option>
          <option value="wage_offered_annual:asc">Wage: Low to High</option>
          <option value="employer_name_canonical:asc">Company: A-Z</option>
        </select>
        <span className="text-sm text-gray-500 ml-auto">
          {loading ? "Loading..." : `${total.toLocaleString()} results`}
        </span>
      </div>

      {/* Results */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase">
              <th className="pb-2 pr-3 font-medium">Company</th>
              <th className="pb-2 pr-3 font-medium">Job Title</th>
              <th className="pb-2 pr-3 font-medium">State</th>
              <th className="pb-2 pr-3 font-medium text-right">Wage</th>
              <th className="pb-2 pr-3 font-medium text-right">vs Prev.</th>
              <th className="pb-2 pr-3 font-medium text-center">Level</th>
              <th className="pb-2 pr-3 font-medium">Visa</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const delta = wageDelta(r.wage_offered_annual, r.prevailing_wage);
              return (
                <tr key={r.case_number} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 pr-3">
                    <Link
                      href={`/sponsor/${r.employer_id}`}
                      className="text-gray-900 hover:text-[#1B4FD8] font-medium"
                    >
                      {r.employer_name_canonical}
                    </Link>
                    {r.is_amendment && (
                      <span className="ml-1 text-xs text-orange-500 font-medium">AMD</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-gray-700 max-w-[200px] truncate">
                    {r.job_title_raw}
                  </td>
                  <td className="py-2.5 pr-3 text-gray-600">
                    {r.worksite_state || "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-medium">
                    {formatWage(r.wage_offered_annual)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-xs">
                    {delta !== null ? (
                      <span className={delta >= 0 ? "text-green-600" : "text-red-600"}>
                        {delta >= 0 ? "+" : ""}{delta.toFixed(0)}%
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-center text-gray-500">
                    {r.wage_level ? `L${r.wage_level}` : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500">
                    {r.visa_class}
                  </td>
                  <td className="py-2.5">
                    <StatusBadge status={r.case_status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {results.length === 0 && !loading && (
        <div className="text-center py-16 text-gray-400">No results found</div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            onClick={() => doSearch(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-30"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-500">
            Page {page} of {Math.ceil(total / 50)}
          </span>
          <button
            onClick={() => doSearch(page + 1)}
            disabled={page >= Math.ceil(total / 50)}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
