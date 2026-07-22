// ============================================================
// GET /api/leads/metrics — indicadores do painel (spec 009, US6/FR-030)
//
// Total, volume por origem, falhas (quantidade e %) e o que ainda
// está na fila — para a empresa ATIVA, no mesmo período do filtro
// da lista.
//
// Duas decisões que valem registro:
//
// 1) Segue o MESMO período do filtro da lista, em vez de ser sempre
//    "hoje" como a FR-030 dizia ao pé da letra. Dois recortes na
//    mesma tela produzem a pergunta "por que o topo diz 3 e a lista
//    diz 40?". O período "Hoje" virou opção do filtro, então o
//    número do dia continua a um clique.
//
// 2) Escopo estrito na empresa ativa — nada de "empresas ativas"
//    agregando várias contas aqui. Misturar escopos numa tela é
//    exatamente a confusão que a migration 512 fechou. A visão
//    entre empresas vive na fila de não-roteados, que é explícita
//    sobre isso.
//
// Contagens via `head: true` (o Postgres conta pelo índice, não
// trafega linha) — a alternativa, baixar as linhas e agregar em JS,
// escala com o volume e não com a resposta.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

const SOURCES = ["site", "meta_form", "meta_ctwa"] as const;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("owner");
    const { searchParams } = new URL(request.url);

    const rawDays = Number(searchParams.get("days") ?? "30");
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const base = () =>
      ctx.supabase
        .from("lead_ingestions")
        .select("id", { count: "exact", head: true })
        .eq("account_id", ctx.accountId)
        .gte("created_at", since);

    const [total, failed, pending, sent, partial, ...bySource] =
      await Promise.all([
        base(),
        base().eq("overall_status", "failed"),
        base().eq("overall_status", "pending"),
        base().eq("overall_status", "sent"),
        base().eq("overall_status", "partially_sent"),
        ...SOURCES.map((s) => base().eq("source", s)),
      ]);

    const firstError = [total, failed, pending, sent, partial, ...bySource].find(
      (r) => r.error,
    );
    if (firstError?.error) {
      console.error("[GET /api/leads/metrics] count error:", firstError.error);
      return NextResponse.json(
        { error: "Failed to load metrics" },
        { status: 500 },
      );
    }

    const totalCount = total.count ?? 0;
    const failedCount = failed.count ?? 0;

    return NextResponse.json({
      days,
      total: totalCount,
      sent: sent.count ?? 0,
      partially_sent: partial.count ?? 0,
      pending: pending.count ?? 0,
      failed: failedCount,
      // Percentual só faz sentido com denominador; sem leads no
      // período devolvemos 0 em vez de NaN.
      failed_pct:
        totalCount > 0 ? Math.round((failedCount / totalCount) * 1000) / 10 : 0,
      by_source: Object.fromEntries(
        SOURCES.map((s, i) => [s, bySource[i].count ?? 0]),
      ) as Record<(typeof SOURCES)[number], number>,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
