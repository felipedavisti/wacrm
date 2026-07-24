// ============================================================
// O modelo canônico do lead (spec 009, FR-008).
//
// Toda origem — Site, Meta Formulário, e futuramente CTWA (010) —
// converge para esta forma ANTES de qualquer roteamento ou entrega.
// É o contrato que mantém o núcleo agnóstico de origem: adicionar
// uma origem nova é escrever um normalizador que devolve isto, sem
// tocar em roteamento, outbox ou destino.
//
// Módulo puro (sem I/O) — testável isoladamente.
// ============================================================

/** Origens de lead. `meta_ctwa` é entregue pela feature 010. */
export type LeadSource = "site" | "meta_form" | "meta_ctwa";

/**
 * Rastreamento de aquisição. São os campos que hoje vivem no Odoo
 * como `ink_new_*` e que passam a viver em `deals.tracking`.
 * Todos opcionais: a ausência de um dado esperado vira pendência
 * sinalizada, nunca descarte (FR-005).
 */
export interface LeadTracking {
  /** Campanha (utm.campaign) — vem de `campaign_name` na Meta. */
  campaign_name?: string;
  campaign_id?: string;
  /** ink_new_utmcampanha */
  adset_name?: string;
  /** ink_new_Id_Campanha */
  adset_id?: string;
  /** ink_new_ID_Lead */
  leadgen_id?: string;
  /** ink_new_ID_Formulario — não se aplica ao CTWA. */
  form_id?: string;
  /** ink_new_Id_Criativo */
  ad_id?: string;
  /** ink_new_Criativo_Facebook */
  ad_name?: string;
  /** Conta de anúncios da Meta. */
  meta_account_id?: string;
  form_name?: string;
  platform?: string;
}

/** Dados de contato normalizados. */
export interface LeadContact {
  name?: string;
  /** Somente dígitos com DDI (ex.: 5571999998888). */
  phone?: string;
  email?: string;
  /** CPF só de dígitos — PII sensível (LGPD, Constituição I). */
  cpf?: string;
  /** ISO date (YYYY-MM-DD). */
  birth_date?: string;
  sex?: string;
  marital_status?: string;
}

/** Uma pergunta/resposta do formulário (Meta ou site). */
export interface LeadAnswer {
  question: string;
  answer: string;
}

/**
 * O lead canônico. `routingKey` é o que o de-para consome: cada
 * origem sabe qual é a sua chave natural (Site = filial, Meta =
 * form_id), mas o roteador não precisa saber de onde veio.
 */
export interface CanonicalLead {
  source: LeadSource;
  medium?: string;
  contact: LeadContact;
  tracking: LeadTracking;
  /** Produto/interesse declarado (entra na dedup do site). */
  product?: string;
  answers?: LeadAnswer[];
  /** Chave de roteamento resolvida pela origem. */
  routingKey: { kind: "filial" | "form_id" | "campaign"; value: string } | null;
  /**
   * Campos esperados que NÃO vieram no evento. Vira pendência
   * visível no painel — o lead é criado de qualquer forma (FR-005).
   */
  missingFields?: string[];
  /**
   * `true` = o lead entrou só com os IDs do webhook e ainda precisa
   * de uma volta na Graph API para ter nome/telefone/e-mail.
   *
   * Existe porque o webhook `leadgen` da Meta NÃO traz dado pessoal.
   * Antes o enriquecimento acontecia na própria rota, antes de
   * persistir — então uma falha da Graph fazia o lead nunca existir,
   * enquanto respondíamos 200 (= "pode esquecer") para a Meta. O
   * enriquecimento passou para o worker, que tem retry e
   * reprocessamento; esta flag é o que ele consulta.
   */
  enrichmentPending?: boolean;
}

/** Só dígitos. */
export function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Normaliza um telefone brasileiro para dígitos com DDI.
 *
 * Os formulários chegam sem DDI (`98984919086` = DDD + 9 dígitos) ou
 * já com ele. Regra: 10 ou 11 dígitos ⇒ falta o 55; 12 ou 13 já têm.
 * Fora disso devolvemos os dígitos como vieram — um número
 * estrangeiro ou truncado não deve ser "consertado" com um 55 na
 * frente, e a validade do dado é tratada como pendência, nunca
 * descarte (FR-010).
 */
export function normalizeBrazilPhone(raw: unknown): string {
  const d = digits(raw);
  if (!d) return "";
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

/** Texto aparado; devolve undefined para vazio (não gravar ""). */
export function text(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  return s === "" ? undefined : s;
}

/**
 * Normaliza o produto para efeito de dedup: o site manda
 * "Plano APH Tradicional" e o de-para/dedup trabalham com
 * "APH TRADICIONAL" (prefixo "Plano " removido, caixa e espaços
 * normalizados) — confirmado contra o payload de produção.
 */
export function normalizeProduct(raw: unknown): string | undefined {
  const s = text(raw);
  if (!s) return undefined;
  return s
    .replace(/^plano\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
