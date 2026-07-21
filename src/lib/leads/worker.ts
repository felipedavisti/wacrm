// ============================================================
// Worker do outbox (spec 009, FR-016).
//
// Roda na aplicação (Node), não no banco: a entrega interna usa o
// mesmo caminho de dados do resto do CRM e a externa é um `fetch`
// normal — erros aparecem no log da aplicação, com stack. O que o
// Postgres provê é só o CLAIM atômico (`FOR UPDATE SKIP LOCKED`,
// RPC da migration 514), que é o que garante que dois ticks
// concorrentes nunca peguem o mesmo job — e, com ele, que o mesmo
// lead não seja reenviado duas vezes ao mesmo tempo (FR-028).
//
// Um tick: reivindica → entrega → fecha (histórico + backoff).
// Nunca lança para o chamador: um job problemático não pode
// derrubar a drenagem dos outros.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalLead } from "./canonical";
import { deliverInternal, PermanentDeliveryError } from "./deliver-internal";

interface DeliveryJob {
  id: string;
  ingestion_id: string;
  destination: "internal" | "external";
  account_id: string | null;
  attempts: number;
}

export interface TickResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

/** Identifica quem reivindicou (aparece em `locked_by`, p/ debug). */
function workerId(): string {
  return `tick-${process.pid}-${Date.now().toString(36)}`;
}

export async function runWorkerTick(
  admin: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<TickResult> {
  const { data: jobs, error } = await admin.rpc("claim_lead_delivery_jobs", {
    p_worker: workerId(),
    p_limit: opts.limit ?? 25,
    p_lease_seconds: 120,
  });

  if (error) {
    console.error("[leads/worker] claim failed:", error);
    return { claimed: 0, succeeded: 0, failed: 0 };
  }

  const claimed = (jobs ?? []) as DeliveryJob[];
  let succeeded = 0;
  let failed = 0;

  for (const job of claimed) {
    try {
      const ref = await deliverJob(admin, job);
      await admin.rpc("finish_lead_delivery_job", {
        p_job_id: job.id,
        p_ok: true,
        p_reason: null,
        p_error_class: null,
        p_external_ref: ref,
      });
      succeeded++;
    } catch (err) {
      // Classificação decide o destino do job: `permanent` encerra
      // (retentar não resolve — falta config/dado); o resto volta
      // para a fila com backoff até esgotar as tentativas.
      const permanent = err instanceof PermanentDeliveryError;
      const reason =
        err instanceof Error ? err.message : "Erro desconhecido na entrega";
      console.error(`[leads/worker] job ${job.id} failed:`, reason);
      await admin.rpc("finish_lead_delivery_job", {
        p_job_id: job.id,
        p_ok: false,
        p_reason: reason,
        p_error_class: permanent ? "permanent" : "retryable",
        p_external_ref: null,
      });
      failed++;
    }
  }

  return { claimed: claimed.length, succeeded, failed };
}

/** Despacha para o adaptador do destino (FR-036). */
async function deliverJob(
  admin: SupabaseClient,
  job: DeliveryJob,
): Promise<string | null> {
  const { data: ingestion, error } = await admin
    .from("lead_ingestions")
    .select(
      "id, account_id, canonical, target_pipeline_id, target_stage_id, contact_id, deal_id",
    )
    .eq("id", job.ingestion_id)
    .maybeSingle();

  if (error || !ingestion) {
    throw new PermanentDeliveryError(
      `Lead ${job.ingestion_id} não encontrado para entrega.`,
    );
  }

  if (job.destination === "internal") {
    const res = await deliverInternal(admin, {
      id: ingestion.id,
      account_id: ingestion.account_id,
      canonical: ingestion.canonical as CanonicalLead,
      target_pipeline_id: ingestion.target_pipeline_id,
      target_stage_id: ingestion.target_stage_id,
      contact_id: ingestion.contact_id,
      deal_id: ingestion.deal_id,
    });
    return res.dealId;
  }

  // Destino externo: implementado na fase da US5. Falha permanente
  // enquanto não existir — melhor um lead visível como "falha:
  // destino externo não implementado" do que 5 retentativas mudas.
  throw new PermanentDeliveryError(
    "Destino externo ainda não implementado (US5 da spec 009).",
  );
}
