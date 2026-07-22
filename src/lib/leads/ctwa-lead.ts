// ============================================================
// Conversa CTWA vira negócio no funil (spec 010, US2/FR-039).
//
// Diferença essencial para o Site e o Meta Form: aqui o contato e a
// conversa JÁ EXISTEM — o webhook da inbox acabou de criá-los. Não
// há o que normalizar de um formulário, nem empresa a descobrir: o
// anúncio aponta para um número, e o número já tem dono. Por isso o
// CTWA não passa por roteamento nem cai na fila de "sem empresa".
//
// O que reaproveitamos da 009 é o que importa: o mesmo ledger
// (`lead_ingestions`), o mesmo outbox e a mesma entrega interna. O
// lead do anúncio aparece no mesmo painel, com o mesmo histórico de
// tentativas, e é reprocessável pelo mesmo botão.
//
// IDEMPOTÊNCIA (FR-040): um negócio por conversa, para sempre — não
// por janela de tempo. A mesma pessoa clicando no anúncio de novo
// amanhã não deve abrir um segundo negócio enquanto o primeiro está
// em andamento; é a mesma oportunidade.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalLead } from "./canonical";
import { trackingFromCtwa, type CtwaEnrichment } from "./ctwa-enrich";
import { deliverInternal } from "./deliver-internal";
import { enqueueDelivery } from "./ingest";

export interface CtwaLeadInput {
  accountId: string;
  contactId: string;
  conversationId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  /** A linha já gravada em `ctwa_referrals`. */
  referral: {
    id: string;
    source_id: string | null;
    source_url?: string | null;
    headline?: string | null;
    ctwa_clid?: string | null;
    raw: unknown;
  };
  enrichment: CtwaEnrichment | null;
}

/**
 * Cria o lead + o negócio. Nunca lança: roda dentro do fluxo de
 * mensagem recebida, e nenhuma falha aqui pode custar a mensagem do
 * cliente na inbox.
 */
export async function createCtwaLead(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  input: CtwaLeadInput,
): Promise<{ ingestionId: string; dealId: string | null } | null> {
  // Um negócio por conversa. A chave é a conversa, não o telefone:
  // a mesma pessoa pode falar com duas empresas do grupo, e são duas
  // oportunidades distintas.
  const dedupKey = `ctwa:${input.conversationId}`;

  try {
    const { data: existing } = await admin
      .from("lead_ingestions")
      .select("id, deal_id")
      .eq("dedup_key", dedupKey)
      .limit(1)
      .maybeSingle();

    if (existing) {
      console.info("[ctwa] conversa já tem lead:", existing.id);
      return { ingestionId: existing.id, dealId: existing.deal_id ?? null };
    }

    const lead: CanonicalLead = {
      source: "meta_ctwa",
      medium: "whatsapp",
      contact: {
        name: input.contactName ?? undefined,
        phone: input.contactPhone ?? undefined,
      },
      tracking: trackingFromCtwa(input.referral, input.enrichment),
      // O criativo é o "produto" que o cliente viu — é o que dá
      // contexto ao vendedor no card do funil.
      product: input.referral.headline ?? undefined,
      // CTWA não tem chave de roteamento: a empresa vem do número.
      routingKey: null,
      // Sem o nome da campanha, o negócio nasce assim mesmo e a
      // pendência fica visível (FR-007) — nunca descartar.
      missingFields: input.enrichment?.campaign_name
        ? undefined
        : ["campaign_name"],
    };

    const { data: created, error } = await admin
      .from("lead_ingestions")
      .insert({
        account_id: input.accountId,
        source: "meta_ctwa",
        medium: "whatsapp",
        dedup_key: dedupKey,
        canonical: lead,
        // Contato e conversa já existem: a entrega só precisa criar
        // o negócio, sem duplicar contato.
        contact_id: input.contactId,
        // Vínculo de verdade (migration 519) — é o que deixa abrir a
        // conversa a partir do lead, e achar a conversa de anúncio
        // que não virou lead.
        conversation_id: input.conversationId,
        routing_status: "resolved",
        overall_status: "pending",
      })
      .select("id, account_id, canonical, target_pipeline_id, target_stage_id, contact_id, deal_id")
      .single();

    if (error || !created) {
      // Corrida: duas mensagens da mesma conversa chegando juntas.
      if (error?.code === "23505") {
        const { data: raced } = await admin
          .from("lead_ingestions")
          .select("id, deal_id")
          .eq("dedup_key", dedupKey)
          .limit(1)
          .maybeSingle();
        if (raced) {
          return { ingestionId: raced.id, dealId: raced.deal_id ?? null };
        }
      }
      console.error("[ctwa] falha ao criar o lead:", error);
      return null;
    }

    // O evento cru, para auditoria e reprocessamento (FR-042).
    await admin.from("lead_raw_events").insert({
      ingestion_id: created.id,
      source: "meta_ctwa",
      payload: input.referral.raw ?? {},
      suppressed: false,
    });

    // Enfileira ANTES de tentar entregar: se a entrega inline falhar
    // (ou o processo morrer no meio), a perna já está no outbox e o
    // worker retenta. A ordem inversa perderia o lead num crash.
    await enqueueDelivery(admin, created.id, input.accountId);

    // Entrega inline para o negócio nascer NA HORA (FR-039), sem
    // esperar o próximo tick do worker. Falhou? O outbox assume.
    try {
      const result = await deliverInternal(admin, {
        id: created.id,
        account_id: created.account_id,
        canonical: created.canonical as CanonicalLead,
        target_pipeline_id: created.target_pipeline_id,
        target_stage_id: created.target_stage_id,
        contact_id: created.contact_id,
        deal_id: created.deal_id,
      });

      // Fecha a perna do outbox: entregue, nada a retentar.
      await admin
        .from("lead_delivery_jobs")
        .update({ status: "succeeded", delivered_at: new Date().toISOString() })
        .eq("ingestion_id", created.id)
        .eq("destination", "internal");
      await admin
        .from("lead_ingestions")
        .update({ overall_status: "sent" })
        .eq("id", created.id);

      console.info("[ctwa] negócio criado:", result.dealId);
      return { ingestionId: created.id, dealId: result.dealId };
    } catch (err) {
      console.error(
        "[ctwa] entrega inline falhou; o worker vai retentar:",
        err instanceof Error ? err.message : err,
      );
      return { ingestionId: created.id, dealId: null };
    }
  } catch (err) {
    console.error("[ctwa] erro inesperado ao criar o lead:", err);
    return null;
  }
}
