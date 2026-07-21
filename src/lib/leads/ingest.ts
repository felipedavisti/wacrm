// ============================================================
// Pipeline de ingestão (spec 009): evento cru → lead rastreável.
//
// Ordem inegociável (Princípio "nunca descartar", FR-004/009/010):
//   1. grava o RAW  — antes de normalizar, antes de rotear;
//   2. idempotência absoluta da Meta (`meta_lead_id`);
//   3. dedup por origem (o suprimido é registrado, não sumido);
//   4. roteia (sem regra ⇒ pendência, não descarte);
//   5. enfileira a entrega (só quando há empresa).
//
// Qualquer erro depois do passo 1 deixa o lead visível e
// reprocessável — nunca um 500 silencioso que perde o evento.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalLead } from "./canonical";
import { buildDedupKey, dedupWindowStart } from "./dedup";
import { resolveRouting } from "./routing";

export interface IngestResult {
  ingestionId: string | null;
  dedup: "created" | "suppressed";
  routing: "resolved" | "pending";
}

/** Registra um evento recusado na autenticação (FR-037). */
export async function recordRejectedEvent(
  admin: SupabaseClient,
  source: string,
  reason: string,
  payload: unknown,
  headers?: Record<string, string>,
): Promise<void> {
  const { error } = await admin.from("lead_rejected_events").insert({
    source,
    reason,
    payload: payload ?? null,
    headers: headers ?? null,
  });
  if (error) {
    // Não pode derrubar a resposta de rejeição — mas precisa gritar.
    console.error("[leads/ingest] failed to record rejected event:", error);
  }
}

/**
 * Executa a ingestão de um lead já normalizado.
 *
 * `rawPayload` é gravado sempre — inclusive quando o lead é
 * suprimido por dedup, caso em que o raw aponta para o lead
 * ORIGINAL que o absorveu (FR-020).
 */
export async function ingestLead(
  admin: SupabaseClient,
  lead: CanonicalLead,
  rawPayload: unknown,
  rawHeaders?: Record<string, string>,
): Promise<IngestResult> {
  // ---- 2. Idempotência absoluta da Meta (FR-018) -------------
  const metaLeadId = lead.tracking.leadgen_id ?? null;
  if (metaLeadId) {
    const { data: existing } = await admin
      .from("lead_ingestions")
      .select("id")
      .eq("meta_lead_id", metaLeadId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      await admin.from("lead_raw_events").insert({
        ingestion_id: existing.id,
        source: lead.source,
        payload: rawPayload ?? {},
        headers: rawHeaders ?? null,
        suppressed: true,
      });
      return {
        ingestionId: existing.id,
        dedup: "suppressed",
        routing: "resolved",
      };
    }
  }

  // ---- 3. Dedup por origem (FR-017/019) ----------------------
  const dedupKey = buildDedupKey(lead);
  if (dedupKey) {
    let q = admin
      .from("lead_ingestions")
      .select("id")
      .eq("dedup_key", dedupKey)
      .order("created_at", { ascending: false })
      .limit(1);

    const windowStart = dedupWindowStart(lead);
    if (windowStart) q = q.gte("created_at", windowStart.toISOString());

    const { data: dupe } = await q.maybeSingle();
    if (dupe) {
      // Suprimir NUNCA é descartar: o evento fica registrado e
      // vinculado ao lead que o absorveu (FR-020).
      await admin.from("lead_raw_events").insert({
        ingestion_id: dupe.id,
        source: lead.source,
        payload: rawPayload ?? {},
        headers: rawHeaders ?? null,
        suppressed: true,
      });
      return { ingestionId: dupe.id, dedup: "suppressed", routing: "resolved" };
    }
  }

  // ---- 4. Roteamento (FR-011) --------------------------------
  const routing = await resolveRouting(admin, lead);

  // ---- 1'. Cria o lead (o raw vai logo abaixo, atômico o bastante:
  //          se o insert do lead falhar, respondemos erro e a origem
  //          reenvia; se o raw falhar, o lead já existe e é visível)
  const { data: created, error } = await admin
    .from("lead_ingestions")
    .insert({
      account_id: routing?.accountId ?? null,
      source: lead.source,
      medium: lead.medium ?? null,
      meta_lead_id: metaLeadId,
      dedup_key: dedupKey,
      canonical: lead,
      target_pipeline_id: routing?.pipelineId ?? null,
      target_stage_id: routing?.stageId ?? null,
      routing_status: routing ? "resolved" : "pending",
      overall_status: "pending",
    })
    .select("id")
    .single();

  if (error || !created) {
    // Corrida na idempotência da Meta: outro request criou o mesmo
    // leadgen entre o SELECT e o INSERT — o UNIQUE fez o seu papel.
    if (error?.code === "23505" && metaLeadId) {
      const { data: raced } = await admin
        .from("lead_ingestions")
        .select("id")
        .eq("meta_lead_id", metaLeadId)
        .limit(1)
        .maybeSingle();
      if (raced) {
        return {
          ingestionId: raced.id,
          dedup: "suppressed",
          routing: "resolved",
        };
      }
    }
    throw new Error(`lead insert failed: ${error?.message ?? "unknown"}`);
  }

  await admin.from("lead_raw_events").insert({
    ingestion_id: created.id,
    source: lead.source,
    payload: rawPayload ?? {},
    headers: rawHeaders ?? null,
    suppressed: false,
  });

  // ---- 5. Enfileira a entrega (só com empresa resolvida) ------
  if (routing) {
    await enqueueDelivery(admin, created.id, routing.accountId);
  }

  return {
    ingestionId: created.id,
    dedup: "created",
    routing: routing ? "resolved" : "pending",
  };
}

/**
 * Cria (ou reabre) a perna de entrega do lead. O destino sai da
 * config da conta — sem linha, interno (FR-036).
 *
 * `upsert` por (ingestion, destination) torna a função segura para
 * reprocessamento: reenviar reusa a linha em vez de duplicar perna.
 */
export async function enqueueDelivery(
  admin: SupabaseClient,
  ingestionId: string,
  accountId: string,
): Promise<void> {
  const { data: cfg } = await admin
    .from("account_destination_config")
    .select("kind")
    .eq("account_id", accountId)
    .maybeSingle();

  const destination = cfg?.kind === "external" ? "external" : "internal";

  const { error } = await admin.from("lead_delivery_jobs").upsert(
    {
      ingestion_id: ingestionId,
      destination,
      account_id: accountId,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    },
    { onConflict: "ingestion_id,destination" },
  );

  if (error) {
    console.error("[leads/ingest] enqueue failed:", error);
    throw new Error(`enqueue failed: ${error.message}`);
  }
}
