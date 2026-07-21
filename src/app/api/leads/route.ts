// ============================================================
// GET /api/leads — painel de operação (spec 009, US3/FR-027)
//
// Lista os leads da empresa ATIVA com filtros combináveis por
// origem, status e período.
//
// ACESSO: **owner apenas** (decisão do PO). O painel expõe o
// payload bruto de cada evento — PII completa, incluindo CPF —, o
// que é bem mais do que o roster operacional precisa ver. `requireRole`
// já falha fechado; o RLS por empresa ativa continua sendo a segunda
// barreira.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

const SOURCES = new Set(["site", "meta_form", "meta_ctwa"]);
const STATUSES = new Set(["pending", "sent", "partially_sent", "failed"]);
const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("owner");
    const { searchParams } = new URL(request.url);

    const source = searchParams.get("source");
    const status = searchParams.get("status");
    const days = Number(searchParams.get("days") ?? "30");
    const page = Math.max(0, Number(searchParams.get("page") ?? "0"));

    let query = ctx.supabase
      .from("lead_ingestions")
      .select(
        "id, source, medium, canonical, routing_status, overall_status, contact_id, deal_id, created_at",
        { count: "exact" },
      )
      .eq("account_id", ctx.accountId);

    if (source && SOURCES.has(source)) query = query.eq("source", source);
    if (status && STATUSES.has(status)) query = query.eq("overall_status", status);

    if (Number.isFinite(days) && days > 0) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      query = query.gte("created_at", since.toISOString());
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (error) {
      console.error("[GET /api/leads] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load leads" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      leads: data ?? [],
      total: count ?? 0,
      page,
      page_size: PAGE_SIZE,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
