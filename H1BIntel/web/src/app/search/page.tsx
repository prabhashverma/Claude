"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { getAllSponsors, type SponsorStat } from "@/lib/data";

const allSponsors = getAllSponsors();

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
  "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
  "TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

function ScoreBadge({ score, tier }: { score: number; tier: string }) {
  const colors: Record<string, string> = {
    excellent: "bg-green-100 text-green-700",
    good: "bg-blue-100 text-blue-700",
    fair: "bg-yellow-100 text-yellow-700",
    poor: "bg-red-100 text-red-700",
    new: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[tier] || colors.new}`}>
      {score.toFixed(0)}
    </span>
  );
}

export default function SearchPage() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialQ = params?.get("q") || "";

  const [query, setQuery] = useState(initialQ);
  const [sortBy, setSortBy] = useState<"score" | "lca" | "wage" | "approval">("score");
  const [minScore, setMinScore] = useState(0);

  const results = useMemo(() => {
    let filtered = allSponsors;

    if (query.trim()) {
      const q = query.toLowerCase();
      filtered = filtered.filter((s) =>
        s.canonical_name?.toLowerCase().includes(q)
      );
    }

    if (minScore > 0) {
      filtered = filtered.filter((s) => s.sponsor_score >= minScore);
    }

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "score": return b.sponsor_score - a.sponsor_score;
        case "lca": return b.lca_total - a.lca_total;
        case "wage": return (b.avg_wage || 0) - (a.avg_wage || 0);
        case "approval": return b.lca_approval_rate - a.lca_approval_rate;
        default: return 0;
      }
    });

    return sorted.slice(0, 100);
  }, [query, sortBy, minScore]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Search Sponsors</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <input
          type="text"
          placeholder="Search company name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[250px] px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] focus:border-transparent"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="score">Sort: Score</option>
          <option value="lca">Sort: LCA Count</option>
          <option value="wage">Sort: Avg Wage</option>
          <option value="approval">Sort: Approval Rate</option>
        </select>
        <select
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value={0}>All scores</option>
          <option value={80}>80+ (Excellent)</option>
          <option value={60}>60+ (Good+)</option>
          <option value={40}>40+ (Fair+)</option>
        </select>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        {results.length} results {results.length === 100 && "(showing top 100)"}
      </p>

      {/* Results table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="pb-3 pr-4 font-medium">Company</th>
              <th className="pb-3 pr-4 font-medium text-center">Score</th>
              <th className="pb-3 pr-4 font-medium text-right">LCA</th>
              <th className="pb-3 pr-4 font-medium text-right">PERM</th>
              <th className="pb-3 pr-4 font-medium text-right">Workers</th>
              <th className="pb-3 pr-4 font-medium text-right">Approval</th>
              <th className="pb-3 pr-4 font-medium text-right">Avg Wage</th>
              <th className="pb-3 font-medium">GC Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {results.map((s) => (
              <tr key={s.employer_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 pr-4">
                  <Link
                    href={`/sponsor/${s.employer_id}`}
                    className="font-medium text-gray-900 hover:text-[#1B4FD8]"
                  >
                    {s.canonical_name}
                  </Link>
                </td>
                <td className="py-3 pr-4 text-center">
                  <ScoreBadge score={s.sponsor_score} tier={s.score_tier} />
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {s.lca_total.toLocaleString()}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {s.perm_total.toLocaleString()}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {s.total_workers.toLocaleString()}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {(s.lca_approval_rate * 100).toFixed(1)}%
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {s.avg_wage ? `$${Math.round(s.avg_wage / 1000)}K` : "—"}
                </td>
                <td className="py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    s.gc_pipeline_strength === "strong" ? "text-green-700 bg-green-50" :
                    s.gc_pipeline_strength === "moderate" ? "text-blue-700 bg-blue-50" :
                    s.gc_pipeline_strength === "weak" ? "text-yellow-700 bg-yellow-50" :
                    s.gc_pipeline_strength === "staffing" ? "text-purple-700 bg-purple-50" :
                    "text-gray-500 bg-gray-50"
                  }`}>
                    {s.gc_pipeline_strength}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">No sponsors found</p>
          <p className="text-sm mt-2">Try a different search term</p>
        </div>
      )}
    </div>
  );
}
