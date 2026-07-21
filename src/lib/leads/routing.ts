// ============================================================
// Roteamento: lead canônico → empresa (+ funil/etapa/App).
// Spec 009, FR-011/012/015.
//
// A empresa é resolvida pelo CADASTRO DA PRÓPRIA CONTA
// (`account_lead_sources`, migration 517) — o mesmo padrão que já
// resolve o WhatsApp pelo `phone_number_id`. Não há mapa central:
// cada empresa declara os formulários e filiais que são dela, e o
// UNIQUE global garante que só uma pode reivindicar cada valor.
//
// Chave por origem (a escolha é do normalizador; o roteador não sabe
// de onde veio):
//   Site → `filial`   ("São Luís")
//   Meta → `form_id`  (cada formulário pertence a uma filial)
//
// Sem cadastro correspondente o lead NÃO é descartado: fica
// `routing_status='pending'` (sem empresa) até alguém cadastrar a
// origem (FR-022/SC-007).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalLead } from "./canonical";

export interface RoutingResult {
  accountId: string;
  pipelineId: string | null;
  stageId: string | null;
  /** App da Meta que enriquece esta origem (só para form_id). */
  metaAppId: string | null;
}

/**
 * Resolve uma origem cadastrada pela chave crua.
 *
 * Existe separado de `resolveRouting` porque a ingestão da Meta
 * precisa saber a conta ANTES de normalizar: é o `form_id` do
 * webhook que diz qual App tem o token capaz de buscar os dados do
 * lead. Sem isso, não haveria o que normalizar.
 */
export async function resolveSourceByKey(
  admin: SupabaseClient,
  kind: "filial" | "form_id",
  value: string,
): Promise<RoutingResult | null> {
  const { data, error } = await admin
    .from("account_lead_sources")
    .select("account_id, pipeline_id, stage_id, meta_app_id")
    .eq("active", true)
    .eq("kind", kind)
    // Case-insensitive: a filial vem digitada de um formulário. O
    // índice único também é por lower(value), então casa 1-para-1.
    .ilike("value", value)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[leads/routing] lead source lookup failed:", error);
    // Falha de consulta não pode virar "roteia errado": trata como
    // pendência, e o reprocessamento resolve depois.
    return null;
  }
  if (!data) return null;

  return {
    accountId: data.account_id,
    pipelineId: data.pipeline_id ?? null,
    stageId: data.stage_id ?? null,
    metaAppId: data.meta_app_id ?? null,
  };
}

/**
 * Resolve a empresa de destino do lead. `null` = pendência de
 * roteamento.
 */
export async function resolveRouting(
  admin: SupabaseClient,
  lead: CanonicalLead,
): Promise<RoutingResult | null> {
  const key = lead.routingKey;
  // 'campaign' não é uma chave cadastrável hoje — Site roteia por
  // filial e Meta por form_id.
  if (!key || (key.kind !== "filial" && key.kind !== "form_id")) return null;
  return resolveSourceByKey(admin, key.kind, key.value);
}

/**
 * Token da Graph API para enriquecer um lead de formulário.
 *
 * Resolvido a partir do App que a conta cadastrou (007 + 517), em
 * vez de uma variável de ambiente global: uma conta pode ter vários
 * Apps da Meta, e cada formulário sabe a qual pertence.
 *
 * Ordem: o App declarado na origem → qualquer App da conta que tenha
 * token → `null`. O último caso não perde o lead: ele entra com os
 * ids do webhook e a pendência fica visível.
 */
export async function resolveLeadsToken(
  admin: SupabaseClient,
  opts: { metaAppId?: string | null; accountId?: string | null },
  decrypt: (value: string) => string,
): Promise<string | null> {
  const pick = async (query: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data } = (await query) as {
      data: { leads_access_token: string | null } | null;
    };
    const token = data?.leads_access_token;
    if (!token) return null;
    try {
      return decrypt(token);
    } catch (err) {
      console.error("[leads/routing] failed to decrypt leads token:", err);
      return null;
    }
  };

  if (opts.metaAppId) {
    const direct = await pick(
      admin
        .from("meta_apps")
        .select("leads_access_token")
        .eq("id", opts.metaAppId)
        .maybeSingle(),
    );
    if (direct) return direct;
  }

  if (opts.accountId) {
    const fallback = await pick(
      admin
        .from("meta_apps")
        .select("leads_access_token")
        .eq("account_id", opts.accountId)
        .not("leads_access_token", "is", null)
        .limit(1)
        .maybeSingle(),
    );
    if (fallback) return fallback;
  }

  return null;
}
