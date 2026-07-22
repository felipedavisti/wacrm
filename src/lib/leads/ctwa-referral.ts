// ============================================================
// Captura de referral CTWA (spec 010, FR-038).
//
// A Meta manda o bloco `referral` só na PRIMEIRA mensagem da
// conversa iniciada por um anúncio Click-to-WhatsApp. Não existe API
// para perguntar depois de qual anúncio veio a conversa — se não
// gravarmos naquele instante, a atribuição está perdida.
//
// Consequência de projeto: esta função NUNCA lança. Ela roda dentro
// do fluxo de mensagem recebida, e uma falha aqui não pode derrubar
// a entrega da mensagem na inbox. Perder a atribuição de um lead é
// ruim; perder a MENSAGEM do cliente é inaceitável.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** O bloco `referral` como a Meta entrega hoje (Cloud API). */
export interface MetaReferral {
  source_url?: string;
  /** ID do anúncio (source_type='ad') ou do post. */
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  /** Correlaciona esta conversa com o clique no Ads Manager. */
  ctwa_clid?: string;
  [key: string]: unknown;
}

export interface CapturedReferral {
  id: string;
  source_id: string | null;
  ctwa_clid: string | null;
}

/**
 * Grava o vínculo `wamid → anúncio`. Idempotente por wamid: a Meta
 * reentrega o webhook quando o ack demora, e reentrega não pode
 * virar um segundo vínculo.
 *
 * Devolve `null` quando não havia referral, quando a gravação falhou
 * (já logada) ou quando a mensagem já tinha sido capturada — o
 * chamador usa isso para decidir se cria o negócio, então "já
 * existia" e "não é CTWA" convergem para o mesmo não-fazer.
 */
export async function captureCtwaReferral(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  params: {
    referral: MetaReferral | undefined;
    wamid: string;
    accountId: string;
    conversationId: string;
    contactId: string;
  },
): Promise<CapturedReferral | null> {
  const { referral } = params;
  // Mensagem comum (não é a 1ª de um clique em anúncio) — o caso
  // esmagadoramente mais frequente. Sai antes de tocar o banco.
  if (!referral || typeof referral !== "object") return null;

  try {
    const { data, error } = await admin
      .from("ctwa_referrals")
      .insert({
        account_id: params.accountId,
        conversation_id: params.conversationId,
        contact_id: params.contactId,
        wamid: params.wamid,
        source_id: referral.source_id ?? null,
        source_type: referral.source_type ?? null,
        source_url: referral.source_url ?? null,
        ctwa_clid: referral.ctwa_clid ?? null,
        headline: referral.headline ?? null,
        body: referral.body ?? null,
        // Íntegro, sempre: é o que permite reprocessar se a Meta
        // mudar o formato ou se descobrirmos um campo que hoje
        // ignoramos.
        raw: referral,
      })
      .select("id, source_id, ctwa_clid")
      .single();

    if (error) {
      // 23505 = reentrega do mesmo wamid. Esperado, não é incidente.
      if ((error as { code?: string }).code === "23505") {
        console.info(
          "[ctwa] referral já capturado para o wamid",
          params.wamid,
        );
        return null;
      }
      console.error("[ctwa] falha ao capturar referral:", error);
      return null;
    }

    console.info(
      "[ctwa] referral capturado:",
      JSON.stringify({
        wamid: params.wamid,
        source_id: data.source_id,
        source_type: referral.source_type,
        // Loga as CHAVES do bloco recebido (não os valores) para
        // sabermos, com tráfego real, se a Meta manda algo que ainda
        // não mapeamos — sem despejar PII no log.
        campos_recebidos: Object.keys(referral).sort().join(","),
      }),
    );

    return data as CapturedReferral;
  } catch (err) {
    console.error("[ctwa] erro inesperado ao capturar referral:", err);
    return null;
  }
}
