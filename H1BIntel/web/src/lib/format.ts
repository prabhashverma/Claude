export function formatWage(wage: number | null): string {
  if (wage == null) return "N/A";
  if (wage >= 1000) return `$${Math.round(wage / 1000)}K`;
  return `$${wage.toLocaleString()}`;
}

export function formatNumber(n: number | null): string {
  if (n == null) return "N/A";
  return n.toLocaleString();
}

export function formatPercent(n: number | null, decimals = 1): string {
  if (n == null) return "N/A";
  return `${(n * 100).toFixed(decimals)}%`;
}

export function wageVsPrevailing(offered: number | null, prevailing: number | null): string | null {
  if (offered == null || prevailing == null || prevailing === 0) return null;
  const pct = ((offered - prevailing) / prevailing) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

export function scoreTierColor(tier: string): string {
  switch (tier) {
    case "excellent": return "text-green-600 bg-green-50";
    case "good": return "text-blue-600 bg-blue-50";
    case "fair": return "text-yellow-600 bg-yellow-50";
    case "poor": return "text-red-600 bg-red-50";
    default: return "text-gray-500 bg-gray-50";
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "certified": return "text-green-700 bg-green-100";
    case "denied": return "text-red-700 bg-red-100";
    case "withdrawn": return "text-gray-600 bg-gray-100";
    case "certified_withdrawn": return "text-yellow-700 bg-yellow-100";
    case "certified_expired": return "text-orange-600 bg-orange-100";
    default: return "text-gray-500 bg-gray-100";
  }
}
