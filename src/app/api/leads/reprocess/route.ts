// ============================================================
// POST /api/leads/reprocess — reenvio (spec 009, US3/FR-028)
//
// O coração do valor da spec: transformar falha silenciosa em falha
// recuperável. Aceita ids explícitos OU "todas as falhas do filtro"
// — porque num incidente o operador precisa recuperar 50 leads numa
// ação, não clicar 50 vezes (SC-003).
//
// Não envia nada aqui: apenas reabre as pernas de entrega
// (`pending`, agora). O worker faz o trabalho no próximo tick, com
// toda a resiliência já existente.
//
// Duplo envio simultâneo é impossível por construção: um job já
// `processing` com lease vigente não é reaberto, e o claim do worker
// usa SKIP LOCKED.
//
// ACESSO: **owner apenas**.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/leads/admin-client";

const SOURCES = new Set(["site", "meta_form", "meta_ctwa"]);
const MAX_BATCH = 500;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");

    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
      all_failed?: unknown;
      source?: unknown;
      days?: unknown;
    } | null;

    let ingestionIds: string[] = [];

    if (Array.isArray(body?.ids) && body.ids.length > 0) {
      ingestionIds = body.ids.filter((v): v is string => typeof v === "string");
    } else if (body?.all_failed === true) {
      // "Selecionar todas as N do filtro" — a seleção acontece no
      // servidor, então cobre além da página visível (FR-028).
      let q = ctx.supabase
        .from("lead_ingestions")
        .select("id")
        .eq("account_id", ctx.accountId)
        .eq("overall_status", "failed");

      if (typeof body.source === "string" && SOURCES.has(body.source)) {
        q = q.eq("source", body.source);
      }
      const days = Number(body.days ?? 30);
      if (Number.isFinite(days) && days > 0) {
        q = q.gte(
          "created_at",
          new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
        );
      }

      const { data, error } = await q.limit(MAX_BATCH);
      if (error) {
        console.error("[POST /api/leads/reprocess] filter error:", error);
        return NextResponse.json(
          { error: "Failed to select leads" },
          { status: 500 },
        );
      }
      ingestionIds = (data ?? []).map((r: { id: string }) => r.id);
    } else {
      return NextResponse.json(
        { error: "Provide 'ids' or 'all_failed': true" },
        { status: 400 },
      );
    }

    if (ingestionIds.length === 0) {
      return NextResponse.json({ requeued: 0 });
    }

    // Escrita via service_role, e NÃO pelo cliente RLS.
    //
    // `lead_delivery_jobs` e `lead_ingestions` são select-only por
    // design (513/514): quem muda o estado da entrega é o worker, por
    // RPC. Um UPDATE pelo cliente RLS não dá erro — ele afeta ZERO
    // linhas em silêncio, e a rota devolvia `requeued: 0` como se não
    // houvesse nada a reprocessar. O botão "Reenviar" do painel nunca
    // funcionou de verdade.
    //
    // A tenancy continua garantida pelo `.eq("account_id", …)` abaixo,
    // com o account vindo da SESSÃO — nunca do corpo do request.
    const admin = supabaseAdmin();

    // Reabre só o que NÃO está em curso. O filtro por account_id é o
    // que impede reprocessar lead de outra empresa por id forjado.
    const { data: reopened, error: updErr } = await admin
      .from("lead_delivery_jobs")
      .update({
        status: "pending",
        next_attempt_at: new Date().toISOString(),
        attempts: 0,
        locked_by: null,
        lease_until: null,
      })
      .in("ingestion_id", ingestionIds)
      .eq("account_id", ctx.accountId)
      .in("status", ["failed", "pending"])
      .select("id");

    if (updErr) {
      console.error("[POST /api/leads/reprocess] update error:", updErr);
      return NextResponse.json(
        { error: "Failed to requeue" },
        { status: 500 },
      );
    }

    // O status do lead volta a "pending" para o painel refletir que
    // há trabalho em curso; o worker recalcula ao concluir.
    await admin
      .from("lead_ingestions")
      .update({ overall_status: "pending" })
      .in("id", ingestionIds)
      .eq("account_id", ctx.accountId);

    return NextResponse.json({ requeued: reopened?.length ?? 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
