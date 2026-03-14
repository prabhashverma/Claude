import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import dns from "dns";

dns.setDefaultResultOrder("ipv4first");

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const XAI_API_KEY = process.env.XAI_API_KEY || "";

let lcaData: any[] | null = null;
let permData: any[] | null = null;
let sponsorData: any[] | null = null;

function loadData() {
  if (!lcaData) {
    lcaData = JSON.parse(readFileSync(join(process.cwd(), "src/data/lca.json"), "utf-8"));
  }
  if (!permData) {
    permData = JSON.parse(readFileSync(join(process.cwd(), "src/data/perm.json"), "utf-8"));
  }
  if (!sponsorData) {
    sponsorData = JSON.parse(readFileSync(join(process.cwd(), "src/data/sponsor_stats.json"), "utf-8"));
  }
}

// Schema description for the LLM
const SCHEMA = `You have 3 datasets:

1. lca_filings (118,580 rows) — H-1B labor condition applications
   Fields: employer_name_canonical, job_title_raw, worksite_state (2-letter), worksite_city,
   wage_offered_annual (number), prevailing_wage (number), wage_level (1-4),
   visa_class (H-1B/H-1B1/E-3), case_status (certified/denied/withdrawn/certified_withdrawn),
   is_amendment (bool), total_workers (int), fiscal_year (2025)

2. perm_filings (147,056 rows) — Green card labor certifications
   Fields: employer_name_canonical, job_title_raw, worksite_state, worksite_city,
   wage_offered_annual, prevailing_wage, case_status (certified/denied/withdrawn/certified_expired),
   worker_citizenship, processing_days (int), fiscal_year (2025)

3. sponsor_stats (21,511 rows) — Pre-computed employer scores
   Fields: canonical_name, employer_id, lca_total, lca_certified, lca_denied, lca_withdrawn,
   lca_approval_rate (0-1), perm_total, perm_certified, total_workers, avg_wage, median_wage,
   sponsor_score (0-100), score_tier (excellent/good/fair/poor/new),
   gc_pipeline_strength (strong/moderate/weak/none/staffing), perm_conversion_rate (0-1),
   top_titles (array of {title,count}), top_worksites (array of {state,count})

Rules:
- approval_rate = certified/(certified+denied). Withdrawn EXCLUDED.
- Wages are annual. Use worksite location, NOT employer HQ.
- FY2025 = Oct 2024 - Sep 2025`;

const SYSTEM_PROMPT = `You are a data query engine for H1BIntel. Given a user question, generate a JSON query spec to execute against the data.

${SCHEMA}

Return ONLY valid JSON in this format:
{
  "dataset": "lca_filings" | "perm_filings" | "sponsor_stats",
  "filters": [{"field": "fieldName", "op": "eq|contains|gte|lte|in", "value": "..."}],
  "sort_by": "fieldName",
  "sort_dir": "desc" | "asc",
  "limit": 10,
  "group_by": "fieldName" | null,
  "agg": "count" | "avg" | "sum" | "median" | "percentiles" | null,
  "agg_field": "fieldName" | null,
  "select": ["field1", "field2"],
  "explanation": "One sentence describing what this query finds"
}

Examples:
Q: "Top H-1B sponsors in California"
{"dataset":"sponsor_stats","filters":[{"field":"top_worksites","op":"state_includes","value":"CA"},{"field":"score_tier","op":"neq","value":"new"}],"sort_by":"lca_total","sort_dir":"desc","limit":10,"group_by":null,"agg":null,"agg_field":null,"select":["canonical_name","sponsor_score","lca_total","avg_wage","gc_pipeline_strength"],"explanation":"Top 10 sponsors with worksites in CA by LCA count"}

Q: "Average salary for software engineers"
{"dataset":"lca_filings","filters":[{"field":"job_title_raw","op":"contains","value":"software"},{"field":"case_status","op":"eq","value":"certified"}],"sort_by":"wage_offered_annual","sort_dir":"desc","limit":0,"group_by":null,"agg":"percentiles","agg_field":"wage_offered_annual","select":[],"explanation":"Wage percentiles for software engineer H-1B filings"}

Q: "Compare Google vs Meta"
{"dataset":"sponsor_stats","filters":[{"field":"canonical_name","op":"in","value":["Google","Meta"]}],"sort_by":"sponsor_score","sort_dir":"desc","limit":10,"group_by":null,"agg":null,"agg_field":null,"select":["canonical_name","sponsor_score","lca_total","perm_total","lca_approval_rate","avg_wage","gc_pipeline_strength"],"explanation":"Side by side comparison of Google and Meta"}`;

async function callGroq(question: string): Promise<any> {
  const providers = [
    { url: "https://api.groq.com/openai/v1/chat/completions", key: GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
    { url: "https://api.x.ai/v1/chat/completions", key: XAI_API_KEY, model: "grok-3-mini-fast" },
  ];

  for (const provider of providers) {
    if (!provider.key) continue;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.key}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: question },
          ],
          temperature: 0,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {
      continue;
    }
  }
  return null;
}

async function formatAnswer(question: string, explanation: string, resultSummary: string): Promise<string> {
  // Use Groq to format a nice natural language answer
  const providers = [
    { url: "https://api.groq.com/openai/v1/chat/completions", key: GROQ_API_KEY, model: "llama-3.3-70b-versatile" },
    { url: "https://api.x.ai/v1/chat/completions", key: XAI_API_KEY, model: "grok-3-mini-fast" },
  ];

  for (const provider of providers) {
    if (!provider.key) continue;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.key}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            {
              role: "system",
              content: "You are an H-1B visa data analyst. Given query results, write a brief, helpful answer. Be specific with numbers. 2-3 sentences max. Note: approval_rate excludes withdrawals. FY2025 = Oct 2024 - Sep 2025. Wages are annual.",
            },
            {
              role: "user",
              content: `User asked: "${question}"\nQuery: ${explanation}\nResults:\n${resultSummary}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const data = await res.json();
      return data.choices?.[0]?.message?.content || explanation;
    } catch {
      continue;
    }
  }
  return explanation;
}

function fmtWage(w: number | null) {
  if (!w) return "N/A";
  return `$${Math.round(w).toLocaleString()}`;
}

function executeQuery(spec: any): { rows: any[]; columns: string[]; summary: string } {
  loadData();

  let data: any[];
  switch (spec.dataset) {
    case "lca_filings": data = [...lcaData!]; break;
    case "perm_filings": data = [...permData!]; break;
    case "sponsor_stats": data = [...sponsorData!]; break;
    default: data = [...sponsorData!];
  }

  // Apply filters
  for (const f of spec.filters || []) {
    const { field, op, value } = f;
    data = data.filter((r) => {
      const v = r[field];
      switch (op) {
        case "eq": return String(v).toLowerCase() === String(value).toLowerCase();
        case "neq": return String(v).toLowerCase() !== String(value).toLowerCase();
        case "contains": return String(v || "").toLowerCase().includes(String(value).toLowerCase());
        case "gte": return (v ?? 0) >= Number(value);
        case "lte": return (v ?? Infinity) <= Number(value);
        case "in": {
          const vals = (Array.isArray(value) ? value : [value]).map((x: string) => x.toLowerCase());
          return vals.some((val: string) => String(v || "").toLowerCase().includes(val));
        }
        case "state_includes": {
          const ws = r.top_worksites;
          return ws && Array.isArray(ws) && ws.some((w: any) => w.state === value);
        }
        default: return true;
      }
    });
  }

  // Aggregation
  if (spec.agg && spec.agg_field) {
    const values = data
      .map((r) => r[spec.agg_field])
      .filter((v) => v != null && !isNaN(v))
      .sort((a: number, b: number) => a - b);

    if (values.length === 0) {
      return { rows: [], columns: [], summary: "No data found for this query." };
    }

    if (spec.agg === "percentiles") {
      const p10 = values[Math.floor(values.length * 0.1)];
      const p25 = values[Math.floor(values.length * 0.25)];
      const p50 = values[Math.floor(values.length * 0.5)];
      const p75 = values[Math.floor(values.length * 0.75)];
      const p90 = values[Math.floor(values.length * 0.9)];
      const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;

      const row = {
        "Sample Size": values.length.toLocaleString(),
        "P10": fmtWage(p10), "P25": fmtWage(p25),
        "Median": fmtWage(p50), "P75": fmtWage(p75),
        "P90": fmtWage(p90), "Average": fmtWage(avg),
      };
      const summary = `${values.length} filings. P25=${fmtWage(p25)}, Median=${fmtWage(p50)}, P75=${fmtWage(p75)}, Avg=${fmtWage(avg)}`;
      return { rows: [row], columns: Object.keys(row), summary };
    }

    if (spec.agg === "avg") {
      const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
      return { rows: [{ "Average": fmtWage(avg), "Count": values.length }], columns: ["Average", "Count"], summary: `Average: ${fmtWage(avg)} from ${values.length} records` };
    }

    if (spec.agg === "count") {
      return { rows: [{ "Count": data.length }], columns: ["Count"], summary: `${data.length} records found` };
    }
  }

  // Sort
  if (spec.sort_by) {
    const dir = spec.sort_dir === "asc" ? 1 : -1;
    data.sort((a, b) => {
      const av = a[spec.sort_by] ?? 0;
      const bv = b[spec.sort_by] ?? 0;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }

  // Limit
  const limit = spec.limit || 10;
  if (limit > 0) data = data.slice(0, limit);

  // Select columns
  const selectCols = spec.select && spec.select.length > 0 ? spec.select : Object.keys(data[0] || {}).slice(0, 8);

  // Format output rows
  const columns = selectCols.map((c: string) => {
    const labels: Record<string, string> = {
      canonical_name: "Company", employer_name_canonical: "Company",
      sponsor_score: "Score", score_tier: "Tier",
      lca_total: "LCA Filings", lca_certified: "Certified",
      lca_denied: "Denied", lca_approval_rate: "Approval Rate",
      perm_total: "PERM Filings", perm_certified: "PERM Certified",
      avg_wage: "Avg Wage", median_wage: "Median Wage",
      wage_offered_annual: "Wage", prevailing_wage: "Prevailing Wage",
      gc_pipeline_strength: "GC Pipeline", perm_conversion_rate: "GC Conversion",
      total_workers: "Workers", job_title_raw: "Job Title",
      worksite_state: "State", worksite_city: "City",
      visa_class: "Visa", case_status: "Status",
      worker_citizenship: "Citizenship", processing_days: "Days",
    };
    return labels[c] || c;
  });

  const rows = data.map((r) => {
    const row: Record<string, any> = {};
    selectCols.forEach((c: string, i: number) => {
      let v = r[c];
      if (c.includes("wage") || c === "avg_wage" || c === "median_wage") v = fmtWage(v);
      else if (c === "lca_approval_rate" || c === "perm_conversion_rate") v = v != null ? `${(v * 100).toFixed(1)}%` : "N/A";
      else if (c === "sponsor_score") v = v != null ? v.toFixed(1) : "N/A";
      else if (typeof v === "number") v = v.toLocaleString();
      row[columns[i]] = v ?? "—";
    });
    return row;
  });

  const summary = rows.slice(0, 5).map((r) => Object.values(r).join(", ")).join("\n");
  return { rows, columns, summary };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = body.question;
  if (!question) {
    return NextResponse.json({ error: "Question required" }, { status: 400 });
  }

  // Step 1: LLM generates query spec
  const spec = await callGroq(question);

  if (!spec) {
    // Fallback to local keyword engine
    return NextResponse.json(localFallback(question));
  }

  // Step 2: Execute query against data
  const { rows, columns, summary } = executeQuery(spec);

  // Step 3: LLM formats natural language answer
  const answer = await formatAnswer(question, spec.explanation || "", summary);

  return NextResponse.json({
    answer,
    data_table: rows.length > 0 ? rows : null,
    columns: rows.length > 0 ? columns : null,
  });
}

// Simple fallback when LLM is unavailable
function localFallback(question: string): any {
  loadData();
  return {
    answer: `H1BIntel has ${lcaData!.length.toLocaleString()} LCA and ${permData!.length.toLocaleString()} PERM filings from ${sponsorData!.length.toLocaleString()} employers. Please try again — the AI service may be temporarily unavailable.`,
    data_table: null,
    columns: null,
  };
}
