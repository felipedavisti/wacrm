// ============================================================
// Completa um lead de formulário da Meta que entrou só com IDs.
//
// POR QUE ISTO EXISTE (correção de 2026-07-24):
//
// O webhook `leadgen` da Meta não traz dado pessoal — só ids. Os
// dados do lead vêm de uma chamada à Graph API. Antes, essa chamada
// acontecia dentro da rota de ingestão, ANTES de persistir. Duas
// consequências ruins:
//
//   1. respondíamos 200 à Meta (= "pode esquecer, é meu") e, se a
//      Graph falhasse, o lead não existia como lead — ia para
//      `lead_rejected_events`, uma tabela sem tela, sem métrica e
//      sem botão de reprocessar. A Meta apagava da fila dela e nós
//      não tínhamos onde ver;
//   2. a rota levava segundos (três chamadas de rede), e numa
//      reentrega da Meta — que é comum — refazíamos as três só para
//      descobrir no fim que era duplicado.
//
// Agora a rota grava primeiro e responde rápido; o enriquecimento
// mora aqui, no worker, que já tem lease, backoff, limite de
// tentativas e reprocessamento pelo painel.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalLead } from "./canonical";
import { enrichMetaLead } from "./meta-graph";
import { normalizeMetaFormLead, type MetaWebhookValue } from "./normalize";
import { resolveLeadsToken, resolveSourceByKey } from "./routing";

/**
 * Devolve o canônico pronto para entrega.
 *
 * - Lead que não precisa de enriquecimento volta inalterado.
 * - Falha da Graph **lança** (retentável): o job volta para a fila
 *   com backoff e, esgotadas as tentativas, aparece como "Falhou" no
 *   painel — reprocessável depois que a causa for corrigida.
 * - Ausência de token NÃO lança: é problema de configuração que
 *   retentativa não resolve. Entrega com os ids que existem e a
 *   pendência fica visível em `missingFields`.
 */
export async function enrichPendingMetaLead(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  ingestion: { id: string; canonical: CanonicalLead },
  decrypt: (value: string) => string,
): Promise<CanonicalLead> {
  const lead = ingestion.canonical;

  if (lead.source !== "meta_form" || !lead.enrichmentPending) return lead;

  const leadgenId = lead.tracking.leadgen_id;
  if (!leadgenId) {
    // Sem o id do lead na Meta não há o que buscar. Não é retentável.
    return clearFlag(admin, ingestion.id, lead);
  }

  const formId = lead.tracking.form_id;
  const source = formId
    ? await resolveSourceByKey(admin, "form_id", formId)
    : null;
  const token = await resolveLeadsToken(
    admin,
    { metaAppId: source?.metaAppId, accountId: source?.accountId },
    decrypt,
  );

  if (!token) {
    console.warn(
      `[leads/enrich] sem token da Meta para o formulário ${formId} — ` +
        "entregando o lead com os ids e a pendência visível.",
    );
    return clearFlag(admin, ingestion.id, lead);
  }

  // Deixa lançar: falha de rede/token vencido é retentável, e o
  // outbox é quem decide quando tentar de novo.
  const enrichment = await enrichMetaLead(token, {
    leadgenId,
    adId: lead.tracking.ad_id,
    formId,
  });

  // Renormaliza a partir do webhook + enriquecimento, para o canônico
  // ficar idêntico ao que a rota produziria com os dados em mãos —
  // uma única definição de "como é um lead de formulário".
  const webhook: MetaWebhookValue = {
    leadgen_id: leadgenId,
    form_id: formId,
    ad_id: lead.tracking.ad_id,
    adgroup_id: lead.tracking.adset_id,
  };
  const completo = normalizeMetaFormLead({ webhook, ...enrichment });

  const { error } = await admin
    .from("lead_ingestions")
    .update({ canonical: completo })
    .eq("id", ingestion.id);

  if (error) {
    // Os dados vieram; só não persistiram. Entrega com eles nesta
    // passagem — o negócio nasce completo, e um reprocessamento
    // futuro regravaria o canônico.
    console.error("[leads/enrich] falha ao gravar o canônico:", error);
  }

  return completo;
}

/** Marca que não há mais o que buscar, sem alterar o resto. */
async function clearFlag(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  ingestionId: string,
  lead: CanonicalLead,
): Promise<CanonicalLead> {
  const next: CanonicalLead = { ...lead, enrichmentPending: undefined };
  await admin
    .from("lead_ingestions")
    .update({ canonical: next })
    .eq("id", ingestionId);
  return next;
}
