import Link from "next/link";
import { getTopSponsors } from "@/lib/data";

export default function SponsorsPage() {
  const sponsors = getTopSponsors(100);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Top H-1B Sponsors by Score
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Ranked by Sponsor Score (0-100). Approval rate excludes withdrawals.
        FY2025 data.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="pb-3 pr-3 font-medium w-8">#</th>
              <th className="pb-3 pr-4 font-medium">Company</th>
              <th className="pb-3 pr-4 font-medium text-center">Score</th>
              <th className="pb-3 pr-4 font-medium text-center">Tier</th>
              <th className="pb-3 pr-4 font-medium text-right">LCA</th>
              <th className="pb-3 pr-4 font-medium text-right">PERM</th>
              <th className="pb-3 pr-4 font-medium text-right">Approval</th>
              <th className="pb-3 pr-4 font-medium text-right">Avg Wage</th>
              <th className="pb-3 font-medium">GC Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {sponsors.map((s, i) => {
              const tierColors: Record<string, string> = {
                excellent: "text-green-700 bg-green-100",
                good: "text-blue-700 bg-blue-100",
                fair: "text-yellow-700 bg-yellow-100",
                poor: "text-red-700 bg-red-100",
              };
              const pipelineColors: Record<string, string> = {
                strong: "text-green-700 bg-green-50",
                moderate: "text-blue-700 bg-blue-50",
                weak: "text-yellow-700 bg-yellow-50",
                none: "text-gray-500 bg-gray-50",
                staffing: "text-purple-700 bg-purple-50",
              };
              return (
                <tr
                  key={s.employer_id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="py-3 pr-3 text-gray-400">{i + 1}</td>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/sponsor/${s.employer_id}`}
                      className="font-medium text-gray-900 hover:text-[#1B4FD8]"
                    >
                      {s.canonical_name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-center font-semibold tabular-nums">
                    {s.sponsor_score.toFixed(1)}
                  </td>
                  <td className="py-3 pr-4 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${tierColors[s.score_tier] || "text-gray-500 bg-gray-100"}`}
                    >
                      {s.score_tier}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {s.lca_total.toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {s.perm_total.toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {(s.lca_approval_rate * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {s.avg_wage ? `$${Math.round(s.avg_wage / 1000)}K` : "—"}
                  </td>
                  <td className="py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${pipelineColors[s.gc_pipeline_strength] || pipelineColors.none}`}
                    >
                      {s.gc_pipeline_strength}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
