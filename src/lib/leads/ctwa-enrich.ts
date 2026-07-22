// ============================================================
// Enriquecimento do referral CTWA (spec 010).
//
// A captura (ctwa-referral.ts) guarda o ID do anúncio. Só isso não
// diz nada ao marketing — ninguém reconhece uma campanha por
// "120250878839060414". Este módulo troca esse ID pelos nomes reais
// via Graph API.
//
// Separado da captura de propósito: a captura precisa ser instantânea
// e infalível (a Meta manda o referral uma vez só); o enriquecimento
// depende de rede e de token, e pode falhar. Juntar os dois faria uma
// falha de rede custar a atribuição inteira. Separados, o pior caso é
// um nome de campanha que chega mais tarde.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCtwaAd } from "./meta-graph";
import { resolveLeadsToken } from "./routing";
import type { LeadTracking } from "./canonical";

export interface EnrichableReferral {
  id: string;
  account_id: string;
  source_id: string | null;
}

export interface CtwaEnrichment {
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  meta_account_id?: string;
}

/**
 * Busca os nomes na Graph e grava na linha do referral.
 *
 * Devolve o que conseguiu (ou `null` em falha). `enriched_at` só é
 * marcado no sucesso — assim o índice parcial de pendentes continua
 * apontando o que falta, e reprocessar é só rodar de novo.
 */
export async function enrichCtwaReferral(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  referral: EnrichableReferral,
  decrypt: (value: string) => string,
): Promise<CtwaEnrichment | null> {
  // Referral de post orgânico (sem anúncio) não tem o que enriquecer.
  if (!referral.source_id) return null;

  const token = await resolveLeadsToken(
    admin,
    { accountId: referral.account_id },
    decrypt,
  );
  if (!token) {
    console.warn(
      "[ctwa] sem token da Meta para a conta",
      referral.account_id,
      "— atribuição fica com o id do anúncio até cadastrarem um.",
    );
    return null;
  }

  let ad;
  try {
    ad = await fetchCtwaAd(token, referral.source_id);
  } catch (err) {
    // Token sem `ads_read`, anúncio de outra conta de anúncios, Graph
    // fora do ar. Nada disso justifica perder o vínculo já gravado.
    console.error(
      "[ctwa] falha ao enriquecer o anúncio",
      referral.source_id,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  if (!ad) return null;

  const enrichment: CtwaEnrichment = {
    ad_name: ad.name ?? undefined,
    adset_id: ad.adset?.id ?? undefined,
    adset_name: ad.adset?.name ?? undefined,
    campaign_id: ad.campaign?.id ?? undefined,
    campaign_name: ad.campaign?.name ?? undefined,
    meta_account_id: ad.account_id ?? undefined,
  };

  const { error } = await admin
    .from("ctwa_referrals")
    .update({
      ad_name: enrichment.ad_name ?? null,
      adset_id: enrichment.adset_id ?? null,
      adset_name: enrichment.adset_name ?? null,
      campaign_id: enrichment.campaign_id ?? null,
      campaign_name: enrichment.campaign_name ?? null,
      enriched_at: new Date().toISOString(),
    })
    .eq("id", referral.id);

  if (error) {
    console.error("[ctwa] falha ao gravar o enriquecimento:", error);
    // Os dados vieram; só não persistiram. Devolve mesmo assim para
    // que o negócio nasça com a campanha certa nesta passagem.
  }

  return enrichment;
}

/**
 * Monta o rastreamento do negócio a partir do referral.
 *
 * `form_id` fica de fora por definição: no CTWA não existe
 * formulário. `leadgen_id` também não — o "lead" é a própria conversa.
 */
export function trackingFromCtwa(
  referral: { source_id: string | null; source_url?: string | null },
  enrichment: CtwaEnrichment | null,
): LeadTracking {
  return {
    ad_id: referral.source_id ?? undefined,
    ad_name: enrichment?.ad_name,
    adset_id: enrichment?.adset_id,
    adset_name: enrichment?.adset_name,
    campaign_id: enrichment?.campaign_id,
    campaign_name: enrichment?.campaign_name,
    meta_account_id: enrichment?.meta_account_id,
    // A Meta manda a URL do post — é o que diz se o anúncio rodou no
    // Instagram ou no Facebook, e o payload real da Vitalmed veio do
    // Instagram.
    platform: platformFromUrl(referral.source_url),
  };
}

function platformFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("facebook.com") || url.includes("fb.me")) return "facebook";
  return undefined;
}
