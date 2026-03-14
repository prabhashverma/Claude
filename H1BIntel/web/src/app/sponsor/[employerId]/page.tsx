import { getSponsorById, getAllSponsors } from "@/lib/data";
import Link from "next/link";
import { notFound } from "next/navigation";

function ScoreRing({ score, tier }: { score: number; tier: string }) {
  const colors: Record<string, string> = {
    excellent: "text-green-600 border-green-400 bg-green-50",
    good: "text-blue-600 border-blue-400 bg-blue-50",
    fair: "text-yellow-600 border-yellow-400 bg-yellow-50",
    poor: "text-red-600 border-red-400 bg-red-50",
    new: "text-gray-500 border-gray-300 bg-gray-50",
  };
  return (
    <div
      className={`w-24 h-24 rounded-full border-4 flex flex-col items-center justify-center ${colors[tier] || colors.new}`}
    >
      <span className="text-3xl font-bold">{score.toFixed(0)}</span>
      <span className="text-xs uppercase font-medium">{tier}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 text-center">
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function ScoreBar({
  label,
  score,
  weight,
}: {
  label: string;
  score: number;
  weight: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-sm text-gray-600 shrink-0">
        {label}{" "}
        <span className="text-gray-400 text-xs">({weight}%)</span>
      </div>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5">
        <div
          className="bg-[#1B4FD8] h-2.5 rounded-full transition-all"
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <div className="w-12 text-right text-sm font-medium tabular-nums">
        {score.toFixed(0)}
      </div>
    </div>
  );
}

export default async function SponsorPage({
  params,
}: {
  params: Promise<{ employerId: string }>;
}) {
  const { employerId } = await params;
  const sponsor = getSponsorById(employerId);

  if (!sponsor) return notFound();

  const breakdown = sponsor.score_breakdown || {};
  const breakdownLabels: Record<string, string> = {
    approval_rate: "Approval Rate",
    wage_competitiveness: "Wage Quality",
    perm_conversion: "GC Pipeline",
    consistency: "Consistency",
    volume: "Filing Volume",
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link
        href="/search"
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block"
      >
        &larr; Back to search
      </Link>

      {/* Header */}
      <div className="flex items-start gap-6 mt-4 mb-8">
        <ScoreRing score={sponsor.sponsor_score} tier={sponsor.score_tier} />
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-gray-900">
            {sponsor.canonical_name}
          </h1>
          <p className="text-gray-500 mt-1">FY2025 | Sponsor Score</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="LCA Filings"
          value={sponsor.lca_total.toLocaleString()}
        />
        <StatCard
          label="Approval Rate"
          value={`${(sponsor.lca_approval_rate * 100).toFixed(1)}%`}
        />
        <StatCard
          label="Workers"
          value={sponsor.total_workers.toLocaleString()}
        />
        <StatCard
          label="GC Pipeline"
          value={sponsor.gc_pipeline_strength}
        />
      </div>

      {/* Score breakdown */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Score Breakdown
        </h2>
        <div className="space-y-3 bg-gray-50 rounded-xl p-6 border border-gray-100">
          {Object.entries(breakdown).map(([key, val]) => (
            <ScoreBar
              key={key}
              label={breakdownLabels[key] || key}
              score={(val as { score: number; weight: number }).score}
              weight={(val as { score: number; weight: number }).weight}
            />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Salary */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Salary Overview
          </h2>
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-100 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Average Wage</span>
              <span className="font-medium tabular-nums">
                {sponsor.avg_wage
                  ? `$${Math.round(sponsor.avg_wage).toLocaleString()}`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Median Wage</span>
              <span className="font-medium tabular-nums">
                {sponsor.median_wage
                  ? `$${Math.round(sponsor.median_wage).toLocaleString()}`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">PERM Filings</span>
              <span className="font-medium tabular-nums">
                {sponsor.perm_total.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">PERM Certified</span>
              <span className="font-medium tabular-nums">
                {sponsor.perm_certified.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">GC Conversion</span>
              <span className="font-medium tabular-nums">
                {(sponsor.perm_conversion_rate * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </section>

        {/* Top Titles */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Top Job Titles
          </h2>
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
            {sponsor.top_titles && sponsor.top_titles.length > 0 ? (
              <div className="space-y-2">
                {sponsor.top_titles.map((t, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-gray-700 truncate mr-4">
                      {t.title}
                    </span>
                    <span className="text-gray-500 tabular-nums shrink-0">
                      {t.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No title data</p>
            )}
          </div>
        </section>
      </div>

      {/* Top Worksites */}
      {sponsor.top_worksites && sponsor.top_worksites.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Top Worksite States
          </h2>
          <div className="flex flex-wrap gap-2">
            {sponsor.top_worksites.map((w, i) => (
              <div
                key={i}
                className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 text-sm"
              >
                <span className="font-medium">{w.state}</span>{" "}
                <span className="text-gray-400">{w.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
