import Link from "next/link";
import { getTopSponsors, getHomeStats } from "@/lib/data";

function ScoreBadge({ score, tier }: { score: number; tier: string }) {
  const colors: Record<string, string> = {
    excellent: "bg-green-100 text-green-700 border-green-200",
    good: "bg-blue-100 text-blue-700 border-blue-200",
    fair: "bg-yellow-100 text-yellow-700 border-yellow-200",
    poor: "bg-red-100 text-red-700 border-red-200",
    new: "bg-gray-100 text-gray-500 border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${colors[tier] || colors.new}`}
    >
      {score.toFixed(0)}
    </span>
  );
}

function formatWage(w: number | null) {
  if (w == null) return "—";
  return `$${Math.round(w / 1000)}K`;
}

export default function HomePage() {
  const stats = getHomeStats();
  const topSponsors = getTopSponsors(15);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="py-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900">
          Find companies that sponsor{" "}
          <span className="text-[#1B4FD8]">H-1B visas</span>
        </h1>
        <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
          Real data from {stats.totalLca.toLocaleString()} LCA and{" "}
          {stats.totalPerm.toLocaleString()} PERM filings. Search sponsors,
          compare salaries, check approval rates.
        </p>
        <div className="mt-8">
          <Link
            href="/search"
            className="inline-flex items-center px-6 py-3 rounded-lg bg-[#1B4FD8] text-white font-medium text-base hover:bg-[#1640B0] transition-colors"
          >
            Search Sponsors
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-8">
        {[
          { label: "LCA Filings", value: stats.totalLca.toLocaleString() },
          { label: "PERM Filings", value: stats.totalPerm.toLocaleString() },
          {
            label: "Employers",
            value: stats.totalEmployers.toLocaleString(),
          },
          {
            label: "Scored Sponsors",
            value: stats.scoredEmployers.toLocaleString(),
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-gray-50 rounded-xl p-5 text-center border border-gray-100"
          >
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </section>

      {/* Top Sponsors */}
      <section className="py-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            Top H-1B Sponsors
          </h2>
          <Link
            href="/sponsors"
            className="text-sm text-[#1B4FD8] hover:underline font-medium"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="pb-3 pr-4 font-medium">#</th>
                <th className="pb-3 pr-4 font-medium">Company</th>
                <th className="pb-3 pr-4 font-medium text-center">Score</th>
                <th className="pb-3 pr-4 font-medium text-right">LCA Filings</th>
                <th className="pb-3 pr-4 font-medium text-right">PERM Filings</th>
                <th className="pb-3 pr-4 font-medium text-right">Approval</th>
                <th className="pb-3 pr-4 font-medium text-right">Avg Wage</th>
                <th className="pb-3 font-medium">GC Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {topSponsors.map((s, i) => (
                <tr
                  key={s.employer_id}
                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <td className="py-3 pr-4 text-gray-400">{i + 1}</td>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/sponsor/${s.employer_id}`}
                      className="font-medium text-gray-900 hover:text-[#1B4FD8] transition-colors"
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
                    {(s.lca_approval_rate * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">
                    {formatWage(s.avg_wage)}
                  </td>
                  <td className="py-3">
                    <PipelineBadge strength={s.gc_pipeline_strength} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Popular Searches */}
      <section className="py-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Popular Searches
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            "Google",
            "Amazon",
            "Microsoft",
            "Apple",
            "Meta",
            "Infosys",
            "TCS",
            "Cognizant",
            "Deloitte",
            "JPMorgan",
          ].map((name) => (
            <Link
              key={name}
              href={`/search?q=${encodeURIComponent(name)}`}
              className="px-3 py-1.5 bg-gray-100 rounded-full text-sm text-gray-700 hover:bg-gray-200 transition-colors"
            >
              {name}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function PipelineBadge({ strength }: { strength: string }) {
  const colors: Record<string, string> = {
    strong: "text-green-700 bg-green-50",
    moderate: "text-blue-700 bg-blue-50",
    weak: "text-yellow-700 bg-yellow-50",
    none: "text-gray-500 bg-gray-50",
    staffing: "text-purple-700 bg-purple-50",
  };
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${colors[strength] || colors.none}`}
    >
      {strength}
    </span>
  );
}
