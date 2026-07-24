// ============================================================
// Normalizadores por origem: evento cru → CanonicalLead (FR-008).
//
// Cada origem tem o seu; o núcleo (roteamento/outbox/destino) só
// conhece o canônico. Adicionar Google Ads/TikTok = mais um
// normalizador aqui, sem tocar em nada abaixo (FR-003).
//
// Módulo puro (sem I/O) — testável isoladamente.
// ============================================================

import {
  digits,
  normalizeBrazilPhone,
  normalizeProduct,
  text,
  type CanonicalLead,
  type LeadAnswer,
  type LeadTracking,
} from "./canonical";

// ------------------------------------------------------------
// Site — o formulário/simulação posta DIRETO no nosso endpoint
// (sem n8n). Campos reais de produção:
//   nome, celular, telefone, email, cpf, data_nascimento,
//   produto, filial, sexo, estado_civil
// ------------------------------------------------------------

/** Campos que esperamos do site; a ausência vira pendência. */
const SITE_EXPECTED = ["nome", "celular", "email", "produto", "filial"] as const;

export function normalizeSiteLead(
  body: Record<string, unknown>,
): CanonicalLead {
  // `celular` é o campo primário; `telefone` é o fallback (no
  // payload real o fixo costuma vir vazio).
  const phone = normalizeBrazilPhone(body.celular || body.telefone);
  const filial = text(body.filial);

  const missingFields = SITE_EXPECTED.filter((k) => !text(body[k]));

  return {
    source: "site",
    medium: "Orgânico",
    contact: {
      name: text(body.nome),
      phone: phone || undefined,
      email: text(body.email)?.toLowerCase(),
      cpf: digits(body.cpf) || undefined,
      birth_date: text(body.data_nascimento),
      sex: text(body.sexo),
      marital_status: text(body.estado_civil),
    },
    tracking: {},
    product: normalizeProduct(body.produto),
    // O site já diz a empresa — roteamento explícito, sem campanha.
    routingKey: filial ? { kind: "filial", value: filial } : null,
    missingFields: missingFields.length > 0 ? [...missingFields] : undefined,
  };
}

// ------------------------------------------------------------
// Meta Lead Form — o webhook só entrega IDs; os dados vêm da Graph
// API. Este normalizador recebe o resultado JÁ ENRIQUECIDO:
//   - `leadgen`  : GET /{leadgen_id}?fields=field_data,...
//   - `adInfo`   : GET /{ad_id}?fields=id,name,account_id,campaign_id,adset_id
//   - `formName` : GET /{form_id}?fields=id,name
//   - `webhook`  : o value original (leadgen_id, form_id, ad_id, ...)
// ------------------------------------------------------------

export interface MetaLeadgen {
  id?: string;
  field_data?: Array<{ name?: string; values?: string[] }>;
  campaign_name?: string;
  campaign_id?: string;
  adset_name?: string;
  adset_id?: string;
  ad_id?: string;
  ad_name?: string;
  form_id?: string;
  platform?: string;
  created_time?: string;
}

export interface MetaAdInfo {
  id?: string;
  name?: string;
  account_id?: string;
  campaign_id?: string;
  adset_id?: string;
}

export interface MetaWebhookValue {
  leadgen_id?: string;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  page_id?: string;
  created_time?: number;
}

/**
 * Achata `field_data` num mapa nome→valor. Os nomes dos campos do
 * formulário MUDAM entre versões do form (o fluxo n8n atual tem
 * if/else para pergunta "antiga" vs "nova") — por isso lemos por
 * lista de aliases e preservamos tudo o que não reconhecemos como
 * pergunta/resposta, em vez de descartar.
 */
function flattenFieldData(
  fieldData: MetaLeadgen["field_data"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldData ?? []) {
    const key = f?.name;
    if (!key) continue;
    out[key] = f.values?.[0] ?? "";
  }
  return out;
}

/** Primeiro alias com valor não-vazio. */
function firstOf(
  raw: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
}

/** Chaves que são identidade (não são "pergunta do formulário"). */
const META_IDENTITY_KEYS = new Set([
  "nome_completo",
  "full_name",
  "telefone",
  "phone_number",
  "email",
]);

/** Underscores viram espaços — os nomes vêm slugificados da Meta. */
function humanize(key: string): string {
  return key.replace(/_/g, " ").trim();
}

const META_EXPECTED = ["nome_completo", "telefone", "email"] as const;

export function normalizeMetaFormLead(input: {
  webhook: MetaWebhookValue;
  leadgen?: MetaLeadgen;
  adInfo?: MetaAdInfo;
  formName?: string;
}): CanonicalLead {
  const { webhook, leadgen, adInfo, formName } = input;
  const raw = flattenFieldData(leadgen?.field_data);

  const name = firstOf(raw, "nome_completo", "full_name");
  const phoneRaw = firstOf(raw, "telefone", "phone_number");
  const email = firstOf(raw, "email");

  // Tudo o que não é identidade é pergunta do formulário — vai
  // inteiro para o canônico (nada se perde quando o form muda).
  const answers: LeadAnswer[] = Object.entries(raw)
    .filter(([k, v]) => !META_IDENTITY_KEYS.has(k) && String(v).trim() !== "")
    .map(([k, v]) => ({ question: humanize(k), answer: String(v).trim() }));

  const tracking: LeadTracking = {
    campaign_name: text(leadgen?.campaign_name),
    campaign_id: text(leadgen?.campaign_id ?? adInfo?.campaign_id),
    adset_name: text(leadgen?.adset_name),
    // O webhook chama de `adgroup_id` o que a Graph chama `adset_id`.
    adset_id: text(leadgen?.adset_id ?? adInfo?.adset_id ?? webhook.adgroup_id),
    leadgen_id: text(leadgen?.id ?? webhook.leadgen_id),
    form_id: text(leadgen?.form_id ?? webhook.form_id),
    ad_id: text(leadgen?.ad_id ?? adInfo?.id ?? webhook.ad_id),
    ad_name: text(leadgen?.ad_name ?? adInfo?.name),
    meta_account_id: text(adInfo?.account_id),
    form_name: text(formName),
    platform: text(leadgen?.platform),
  };

  const missingFields = META_EXPECTED.filter((k) => !firstOf(raw, k));
  const formId = tracking.form_id;

  return {
    source: "meta_form",
    medium: "Tráfego Pago",
    contact: {
      name,
      phone: phoneRaw ? normalizeBrazilPhone(phoneRaw) : undefined,
      email: email?.toLowerCase(),
    },
    tracking,
    answers: answers.length > 0 ? answers : undefined,
    // Cada formulário pertence a uma filial/empresa — é a chave de
    // roteamento da Meta (o antigo `mapaFilial` do n8n).
    routingKey: formId ? { kind: "form_id", value: formId } : null,
    missingFields: missingFields.length > 0 ? [...missingFields] : undefined,
    // Sem `leadgen` não houve chamada à Graph — o lead tem só os IDs
    // do webhook e o worker precisa completar. A recuperação ativa
    // (011) já chega com o leadgen em mãos, então lá isto é false.
    enrichmentPending: leadgen ? undefined : true,
  };
}
