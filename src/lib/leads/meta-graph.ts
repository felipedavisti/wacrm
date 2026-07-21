// ============================================================
// Enriquecimento do lead da Meta via Graph API (spec 009, US1).
//
// O webhook `leadgen` NÃO traz dados pessoais — só IDs
// (`leadgen_id`, `form_id`, `ad_id`). Os dados do lead vêm de três
// chamadas à Graph, exatamente como o fluxo n8n `RECEBE LEADS` fazia:
//
//   1. GET /{ad_id}      → conta / campanha / adset do anúncio
//   2. GET /{leadgen_id} → field_data (nome/telefone/email + perguntas)
//                          + nomes de campanha/adset/anúncio
//   3. GET /{form_id}    → nome do formulário
//
// Chamadas 2 e 3 dependem só de IDs do webhook, então rodam em
// paralelo com a 1.
//
// Falha aqui é RETENTÁVEL: a Graph pode estar fora, o token pode ter
// expirado. O lead já está persistido (o raw veio antes) — a entrega
// tenta de novo pelo outbox. Nunca perdemos o lead por causa disso.
// ============================================================

import type { MetaAdInfo, MetaLeadgen } from "./normalize";

const GRAPH_VERSION = "v24.0";

export class MetaGraphError extends Error {}

function graphUrl(path: string, fields: string): string {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.searchParams.set("fields", fields);
  return url.toString();
}

async function graphGet<T>(
  url: string,
  token: string,
  label: string,
): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new MetaGraphError(
      `Graph API inacessível ao buscar ${label}: ${
        err instanceof Error ? err.message : "erro de rede"
      }`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 4xx da Graph costuma ser token/permissão — ainda assim tratamos
    // como retentável: o operador corrige o token e reprocessa, sem
    // ter perdido o lead.
    throw new MetaGraphError(
      `Graph API retornou ${res.status} ao buscar ${label}: ${body.slice(0, 300)}`,
    );
  }

  return (await res.json()) as T;
}

export interface MetaEnrichment {
  leadgen?: MetaLeadgen;
  adInfo?: MetaAdInfo;
  formName?: string;
}

/**
 * Busca os dados reais do lead. `leadgenId` é obrigatório; `adId` e
 * `formId` são opcionais (o webhook sempre manda, mas a recuperação
 * ativa (011) pode não ter).
 */
export async function enrichMetaLead(
  token: string,
  ids: { leadgenId: string; adId?: string; formId?: string },
): Promise<MetaEnrichment> {
  const leadgenP = graphGet<MetaLeadgen>(
    graphUrl(
      ids.leadgenId,
      "id,field_data,created_time,campaign_name,campaign_id,ad_id,ad_name,adset_name,adset_id,platform,form_id",
    ),
    token,
    "o lead",
  );

  const adP = ids.adId
    ? graphGet<MetaAdInfo>(
        graphUrl(ids.adId, "id,name,account_id,campaign_id,adset_id"),
        token,
        "o anúncio",
      ).catch(() => undefined) // enriquecimento secundário: não bloqueia
    : Promise.resolve(undefined);

  const formP = ids.formId
    ? graphGet<{ id?: string; name?: string }>(
        graphUrl(ids.formId, "id,name"),
        token,
        "o formulário",
      ).catch(() => undefined)
    : Promise.resolve(undefined);

  const [leadgen, adInfo, form] = await Promise.all([leadgenP, adP, formP]);

  return { leadgen, adInfo, formName: form?.name };
}

/**
 * Lista leads de um formulário (usado pela recuperação ativa da 011
 * e útil para testar com dado real sem esperar um lead novo).
 */
export async function listFormLeads(
  token: string,
  formId: string,
  limit = 5,
): Promise<MetaLeadgen[]> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/${formId}/leads`,
  );
  url.searchParams.set(
    "fields",
    "id,created_time,field_data,campaign_name,campaign_id,ad_id,ad_name,adset_name,adset_id,platform,form_id",
  );
  url.searchParams.set("limit", String(limit));

  const res = await graphGet<{ data?: MetaLeadgen[] }>(
    url.toString(),
    token,
    "os leads do formulário",
  );
  return res?.data ?? [];
}
