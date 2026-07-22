// ============================================================
// Marca o contato com a origem por onde ele chegou (spec 010).
//
// A tag é PROJEÇÃO do dado estruturado (`lead_ingestions.source`),
// nunca a fonte de verdade. Se alguém apagar a marca, o lead
// continua sendo de anúncio e um reprocessamento devolve.
//
// Amarrada ao `slug` (migration 520), não ao nome: o usuário pode
// renomear "Origem: WhatsApp Anúncio" à vontade sem quebrar nada
// que dependa da marca — inclusive a escolha de agente.
//
// Best-effort por definição: nenhuma falha aqui pode custar o lead.
// Um contato sem tag é um contato mal segmentado; um lead perdido é
// dinheiro perdido.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LeadSource } from "./canonical";

/** Origem do lead → slug da tag do sistema. */
const SLUG_BY_SOURCE: Record<LeadSource, string> = {
  meta_ctwa: "origin_ctwa",
  site: "origin_site",
  meta_form: "origin_meta_form",
};

/**
 * Aplica a tag de origem ao contato. Idempotente: `contact_tags` tem
 * UNIQUE (contact_id, tag_id), então repetir não duplica.
 *
 * Um contato acumula origens de propósito — quem preencheu o site em
 * março e clicou no anúncio em julho veio pelos dois caminhos, e as
 * duas marcas são verdade sobre ele.
 */
export async function applyOriginTag(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  params: { accountId: string; contactId: string; source: LeadSource },
): Promise<void> {
  const slug = SLUG_BY_SOURCE[params.source];
  if (!slug) return;

  try {
    const { data: tag, error: tagErr } = await admin
      .from("tags")
      .select("id")
      .eq("account_id", params.accountId)
      .eq("slug", slug)
      .maybeSingle();

    if (tagErr) {
      console.error("[leads/origin-tag] falha ao buscar a tag:", tagErr);
      return;
    }
    if (!tag) {
      // Empresa criada antes da 520, ou semeadura que não rodou. Não
      // é erro fatal — só perde a segmentação até alguém rodar
      // `ensure_origin_tags`.
      console.warn(
        `[leads/origin-tag] empresa ${params.accountId} sem a tag "${slug}"`,
      );
      return;
    }

    const { error } = await admin
      .from("contact_tags")
      .upsert(
        { contact_id: params.contactId, tag_id: tag.id },
        { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
      );

    if (error) {
      console.error("[leads/origin-tag] falha ao marcar o contato:", error);
    }
  } catch (err) {
    console.error("[leads/origin-tag] erro inesperado:", err);
  }
}
