// ============================================================
// Roteamento: lead canônico → empresa (+ funil/estágio).
// Spec 009, FR-011/012/015.
//
// A chave de casamento é a natural de cada origem, e quem a escolhe
// é o normalizador (o roteador não sabe de onde veio):
//   Site → `filial`   ("São Luís")
//   Meta → `form_id`  (cada formulário pertence a uma filial)
//
// Sem regra correspondente o lead NÃO é descartado: fica
// `routing_status='pending'` (sem empresa), visível na fila central
// até alguém cadastrar o de-para (FR-022/SC-007).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalLead } from "./canonical";

export interface RoutingResult {
  accountId: string;
  pipelineId: string | null;
  stageId: string | null;
}

/**
 * Resolve a empresa de destino do lead. `null` = pendência de
 * roteamento.
 *
 * O casamento é case-insensitive no valor porque a filial vem
 * digitada de um formulário ("São Luís" / "SÃO LUÍS"), e uma regra
 * só vale se estiver `active`. Regras específicas da origem vencem
 * as genéricas (`source IS NULL`) — assim dá para ter uma regra
 * global de fallback sem que ela roube o roteamento de uma origem
 * que tem regra própria.
 */
export async function resolveRouting(
  admin: SupabaseClient,
  lead: CanonicalLead,
): Promise<RoutingResult | null> {
  const key = lead.routingKey;
  if (!key) return null;

  const { data, error } = await admin
    .from("routing_map")
    .select("account_id, pipeline_id, stage_id, source")
    .eq("active", true)
    .eq("match_kind", key.kind)
    .ilike("match_value", key.value)
    .in("source", [lead.source])
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[leads/routing] routing_map lookup failed:", error);
    // Falha de consulta não pode virar "roteia errado": trata como
    // pendência e o reprocessamento resolve depois.
    return null;
  }

  if (data) {
    return {
      accountId: data.account_id,
      pipelineId: data.pipeline_id ?? null,
      stageId: data.stage_id ?? null,
    };
  }

  // Fallback: regra genérica (sem origem declarada).
  const { data: generic } = await admin
    .from("routing_map")
    .select("account_id, pipeline_id, stage_id")
    .eq("active", true)
    .eq("match_kind", key.kind)
    .ilike("match_value", key.value)
    .is("source", null)
    .limit(1)
    .maybeSingle();

  if (!generic) return null;

  return {
    accountId: generic.account_id,
    pipelineId: generic.pipeline_id ?? null,
    stageId: generic.stage_id ?? null,
  };
}
