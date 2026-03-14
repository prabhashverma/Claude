import { NextRequest, NextResponse } from "next/server";
import { searchPERM } from "@/lib/server-data";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const results = searchPERM({
    employer: sp.get("employer") || undefined,
    title: sp.get("title") || undefined,
    state: sp.get("state") || undefined,
    citizenship: sp.get("citizenship") || undefined,
    status: sp.get("status") || undefined,
    wage_min: sp.get("wage_min") ? Number(sp.get("wage_min")) : undefined,
    wage_max: sp.get("wage_max") ? Number(sp.get("wage_max")) : undefined,
    page: sp.get("page") ? Number(sp.get("page")) : 1,
    per_page: sp.get("per_page") ? Number(sp.get("per_page")) : 50,
    sort_by: sp.get("sort_by") || "wage_offered_annual",
    sort_dir: sp.get("sort_dir") || "desc",
  });

  return NextResponse.json(results);
}
