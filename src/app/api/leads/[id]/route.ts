// ============================================================
// GET /api/leads/[id] — detalhe do lead (spec 009, FR-029)
//
// Devolve o canônico, o PAYLOAD BRUTO de cada evento recebido, o
// histórico de tentativas com o erro de cada uma, e os eventos
// suprimidos por dedup vinculados a este lead.
//
// ACESSO: **owner apenas** — é aqui que a PII crua aparece (CPF,
// telefone, respostas do formulário). O `.eq('account_id')` garante
// que um id de outra empresa não retorne nada, mesmo adivinhado.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("owner");
    const { id } = await params;

    const { data: lead, error } = await ctx.supabase
      .from("lead_ingestions")
      .select(
        "id, source, medium, canonical, meta_lead_id, dedup_key, routing_status, overall_status, contact_id, deal_id, created_at, updated_at",
      )
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/leads/[id]] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load lead" },
        { status: 500 },
      );
    }
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Eventos crus: o original + os suprimidos por dedup que este
    // lead absorveu (FR-020) — é o que prova que nada se perdeu.
    const { data: events } = await ctx.supabase
      .from("lead_raw_events")
      .select("id, source, payload, headers, suppressed, received_at")
      .eq("ingestion_id", id)
      .order("received_at", { ascending: true });

    // Pernas de entrega + o histórico de tentativas de cada uma.
    const { data: jobs } = await ctx.supabase
      .from("lead_delivery_jobs")
      .select(
        "id, destination, status, attempts, max_attempts, next_attempt_at, last_error, external_ref",
      )
      .eq("ingestion_id", id);

    const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);
    const { data: attempts } = jobIds.length
      ? await ctx.supabase
          .from("lead_delivery_attempts")
          .select("job_id, attempt_no, outcome, error_class, reason, started_at, finished_at")
          .in("job_id", jobIds)
          .order("attempt_no", { ascending: true })
      : { data: [] };

    return NextResponse.json({
      lead,
      events: events ?? [],
      jobs: jobs ?? [],
      attempts: attempts ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
