// ============================================================
// Destino INTERNO: o lead vira um NEGÓCIO no funil (spec 009, FR-014).
//
// "Já temos o conceito" — a área de Funil do CRM. A entrega:
//   1. acha ou cria o `contact` (dedup por telefone na empresa,
//      migration 022);
//   2. cria o `deal` no funil-alvo (do de-para) ou no funil de
//      entrada padrão da empresa, no primeiro estágio;
//   3. grava o rastreamento de campanha em `deals.tracking`.
//
// Erros são classificados para o outbox: `retryable` (indisponível,
// tenta de novo) vs `permanent` (configuração/dado — retentar não
// resolve; some do backoff e espera um humano + reprocessar).
//
// Isolamento (Constituição II): roda em service_role, então TODA
// escrita carimba o `accountId` resolvido — validado por
// `requireAccountScope` na entrada.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAccountScope } from "@/lib/auth/account-scope";

import { digits, type CanonicalLead } from "./canonical";

export class PermanentDeliveryError extends Error {
  readonly errorClass = "permanent" as const;
}

export interface InternalDeliveryResult {
  contactId: string;
  dealId: string;
}

/** Título do negócio: o que o operador lê no card do funil. */
function dealTitle(lead: CanonicalLead): string {
  const who = lead.contact.name?.trim() || lead.contact.phone || "Lead";
  const what = lead.product ?? lead.tracking.form_name;
  return what ? `${who} — ${what}` : who;
}

/**
 * Acha ou cria o contato da empresa. A dedup usa o mesmo eixo do
 * CRM: `(account_id, phone_normalized)` é UNIQUE (migration 022).
 * Sem telefone caímos no e-mail; sem os dois, cria um contato novo
 * (nunca perder o lead — a falta de identidade vira pendência).
 */
async function findOrCreateContact(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  lead: CanonicalLead,
): Promise<string> {
  const phone = lead.contact.phone ?? "";
  const phoneDigits = digits(phone);

  if (phoneDigits) {
    const { data: byPhone } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .eq("phone_normalized", phoneDigits)
      .limit(1)
      .maybeSingle();
    if (byPhone) return byPhone.id;
  } else if (lead.contact.email) {
    const { data: byEmail } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .ilike("email", lead.contact.email)
      .limit(1)
      .maybeSingle();
    if (byEmail) return byEmail.id;
  }

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: lead.contact.name ?? null,
      email: lead.contact.email ?? null,
    })
    .select("id")
    .single();

  if (error || !created) {
    // Corrida: outro job criou o mesmo contato entre o SELECT e o
    // INSERT e o UNIQUE (account, phone) barrou. Reler é a resposta
    // certa — não é falha de entrega.
    if (error?.code === "23505" && phoneDigits) {
      const { data: raced } = await admin
        .from("contacts")
        .select("id")
        .eq("account_id", accountId)
        .eq("phone_normalized", phoneDigits)
        .limit(1)
        .maybeSingle();
      if (raced) return raced.id;
    }
    throw new Error(`contact insert failed: ${error?.message ?? "unknown"}`);
  }

  return created.id;
}

/**
 * Funil e estágio de destino: o do de-para quando houver, senão o
 * funil de entrada padrão (o mais antigo da empresa) no primeiro
 * estágio. Empresa sem funil é erro PERMANENTE — retentar não cria
 * um funil; alguém precisa configurar e reprocessar.
 */
async function resolveTarget(
  admin: SupabaseClient,
  accountId: string,
  pipelineId: string | null,
  stageId: string | null,
): Promise<{ pipelineId: string; stageId: string }> {
  let pipeline: string;

  if (pipelineId) {
    pipeline = pipelineId;
  } else {
    const { data } = await admin
      .from("pipelines")
      .select("id")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) {
      throw new PermanentDeliveryError(
        "A empresa não tem nenhum funil configurado — crie um funil e reprocese o lead.",
      );
    }
    pipeline = data.id as string;
  }

  if (stageId) return { pipelineId: pipeline, stageId };

  const { data: stage } = await admin
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipeline)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stage) {
    throw new PermanentDeliveryError(
      "O funil de destino não tem nenhuma etapa — crie a primeira etapa e reprocese o lead.",
    );
  }

  return { pipelineId: pipeline, stageId: stage.id };
}

/**
 * Entrega interna. Idempotente por lead: se a ingestão já aponta
 * para um `deal_id`, o reprocessamento não cria um segundo negócio.
 */
export async function deliverInternal(
  admin: SupabaseClient,
  ingestion: {
    id: string;
    account_id: string | null;
    canonical: CanonicalLead;
    target_pipeline_id: string | null;
    target_stage_id: string | null;
    contact_id: string | null;
    deal_id: string | null;
  },
): Promise<InternalDeliveryResult> {
  // Fail-closed: nunca rodar uma escrita service_role sem conta.
  const accountId = requireAccountScope(ingestion.account_id);
  const lead = ingestion.canonical;

  if (ingestion.deal_id && ingestion.contact_id) {
    return { contactId: ingestion.contact_id, dealId: ingestion.deal_id };
  }

  // Atribuição: o dono da empresa, mesmo critério que o webhook usa
  // para carimbar `user_id` em linhas criadas por máquina.
  const { data: account } = await admin
    .from("accounts")
    .select("owner_user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account?.owner_user_id) {
    throw new PermanentDeliveryError(
      `Empresa ${accountId} não tem responsável (owner) definido.`,
    );
  }
  const ownerUserId = account.owner_user_id;

  const contactId =
    ingestion.contact_id ??
    (await findOrCreateContact(admin, accountId, ownerUserId, lead));

  const target = await resolveTarget(
    admin,
    accountId,
    ingestion.target_pipeline_id,
    ingestion.target_stage_id,
  );

  const { data: deal, error: dealErr } = await admin
    .from("deals")
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      pipeline_id: target.pipelineId,
      stage_id: target.stageId,
      contact_id: contactId,
      title: dealTitle(lead),
      // Rastreamento de aquisição (os ex-`ink_new_*`) + a origem,
      // para relatório por campanha direto no funil.
      tracking: {
        ...lead.tracking,
        source: lead.source,
        medium: lead.medium ?? null,
        product: lead.product ?? null,
      },
      notes: formatAnswers(lead),
    })
    .select("id")
    .single();

  if (dealErr || !deal) {
    throw new Error(`deal insert failed: ${dealErr?.message ?? "unknown"}`);
  }

  await admin
    .from("lead_ingestions")
    .update({ contact_id: contactId, deal_id: deal.id })
    .eq("id", ingestion.id);

  return { contactId, dealId: deal.id };
}

/** Perguntas/respostas do formulário viram as notas do negócio. */
function formatAnswers(lead: CanonicalLead): string | null {
  if (!lead.answers || lead.answers.length === 0) return null;
  return lead.answers.map((a) => `${a.question}\n${a.answer}`).join("\n\n");
}
