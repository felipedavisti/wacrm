// ============================================================
// POST /api/leads/unrouted/resolve (spec 009, US4/FR-022/SC-007)
//
// Uma ação resolve o problema inteiro: o operador diz "este
// formulário é da empresa X" e o sistema
//   1. cadastra a origem (para os PRÓXIMOS leads roteiem sozinhos);
//   2. adota os leads que já estavam parados com aquela chave;
//   3. enfileira a entrega deles.
//
// Sem o passo 1, o mesmo problema voltaria amanhã. Sem o 2, os leads
// já pagos continuariam parados. Fazer os dois juntos é o que
// transforma "campanha nova da agência" em um clique, em vez de um
// chamado técnico.
//
// Acesso: owner — e só para empresas que ELE possui (senão o owner
// da empresa A poderia despejar leads na empresa B).
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireDeploymentAdmin } from "@/lib/auth/deployment-admin";
import { supabaseAdmin } from "@/lib/leads/admin-client";
import type { CanonicalLead } from "@/lib/leads/canonical";
import { enqueueDelivery } from "@/lib/leads/ingest";

const KINDS = new Set(["form_id", "filial"]);

export async function POST(request: Request) {
  try {
    const ctx = await requireDeploymentAdmin();

    const body = (await request.json().catch(() => null)) as {
      kind?: unknown;
      value?: unknown;
      account_id?: unknown;
      register?: unknown;
      meta_app_id?: unknown;
      pipeline_id?: unknown;
    } | null;

    const kind = body?.kind;
    const value = typeof body?.value === "string" ? body.value.trim() : "";
    const accountId = body?.account_id;

    if (typeof kind !== "string" || !KINDS.has(kind)) {
      return NextResponse.json(
        { error: "'kind' must be one of form_id, filial" },
        { status: 400 },
      );
    }
    if (!value) {
      return NextResponse.json({ error: "'value' is required" }, { status: 400 });
    }
    if (typeof accountId !== "string" || !accountId) {
      return NextResponse.json(
        { error: "'account_id' is required" },
        { status: 400 },
      );
    }
    // A trava que impede direcionar lead para empresa alheia.
    if (!ctx.ownedAccountIds.includes(accountId)) {
      return NextResponse.json(
        { error: "You can only route leads into companies you own" },
        { status: 403 },
      );
    }

    const admin = supabaseAdmin();

    // 1. Cadastra a origem para os próximos leads (idempotente: se
    //    já existir, seguimos — o objetivo é o estado final).
    if (body?.register !== false) {
      const { error: srcErr } = await admin.from("account_lead_sources").insert({
        account_id: accountId,
        kind,
        value,
        meta_app_id:
          typeof body?.meta_app_id === "string" ? body.meta_app_id : null,
        pipeline_id:
          typeof body?.pipeline_id === "string" ? body.pipeline_id : null,
      });
      if (srcErr && srcErr.code !== "23505") {
        console.error("[unrouted/resolve] source insert error:", srcErr);
        return NextResponse.json(
          { error: "Failed to register the lead source" },
          { status: 500 },
        );
      }
      if (srcErr?.code === "23505") {
        // Já cadastrada — pode ser de OUTRA empresa. Nesse caso não
        // adotamos os leads: seria roubar a origem de quem a
        // registrou primeiro.
        const { data: owner } = await admin
          .from("account_lead_sources")
          .select("account_id")
          .eq("kind", kind)
          .ilike("value", value)
          .maybeSingle();
        if (owner && owner.account_id !== accountId) {
          return NextResponse.json(
            {
              error:
                "Esta origem já pertence a outra empresa. Remova o cadastro lá antes de reatribuir.",
            },
            { status: 409 },
          );
        }
      }
    }

    // 2. Adota os leads parados com esta chave. Filtrar por
    //    `routing_status='pending'` garante que só mexemos em quem
    //    está órfão — nunca em lead que já tem dono.
    const { data: pending, error: pendErr } = await admin
      .from("lead_ingestions")
      .select("id, canonical")
      .eq("routing_status", "pending")
      .limit(500);

    if (pendErr) {
      console.error("[unrouted/resolve] pending fetch error:", pendErr);
      return NextResponse.json(
        { error: "Failed to load pending leads" },
        { status: 500 },
      );
    }

    const matching = (pending ?? []).filter((row: { canonical: CanonicalLead }) => {
      const key = row.canonical?.routingKey;
      return (
        key?.kind === kind && key.value.toLowerCase() === value.toLowerCase()
      );
    });

    if (matching.length === 0) {
      return NextResponse.json({ adopted: 0, registered: true });
    }

    const ids = matching.map((r: { id: string }) => r.id);
    const { error: updErr } = await admin
      .from("lead_ingestions")
      .update({ account_id: accountId, routing_status: "resolved" })
      .in("id", ids);

    if (updErr) {
      console.error("[unrouted/resolve] adopt error:", updErr);
      return NextResponse.json(
        { error: "Failed to assign the leads" },
        { status: 500 },
      );
    }

    // 3. Enfileira a entrega de cada um.
    for (const id of ids) {
      try {
        await enqueueDelivery(admin, id, accountId);
      } catch (err) {
        // Um enqueue que falha não pode derrubar os outros — o lead
        // continua adotado e visível, e o reprocessamento o pega.
        console.error(`[unrouted/resolve] enqueue failed for ${id}:`, err);
      }
    }

    return NextResponse.json({ adopted: ids.length, registered: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
