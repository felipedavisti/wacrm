// ============================================================
// Recuperação ativa de leads na Meta (spec 011, US1).
//
// Pergunta à Meta "quais leads existem neste período?" e compara com
// o que temos. É a contingência para o que o webhook não trouxe:
// token vencido, formulário criado sem avisar, indisponibilidade
// nossa durante um pico de campanha.
//
// Duas passagens de propósito (FR-024/025):
//   scan   → só compara e mostra o que falta (nada é criado)
//   import → cria os ausentes
//
// Ninguém deveria clicar "importar" sem antes ver quantos são e de
// qual formulário. Um scan que já importa transforma uma conferência
// numa ação irreversível.
//
// A não-duplicação NÃO depende deste módulo: `ingestLead` já é
// idempotente por `meta_lead_id` (FR-018). Aqui a comparação serve
// para MOSTRAR o que falta; se dois operadores importarem ao mesmo
// tempo, o ledger absorve.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { ingestLead } from "./ingest";
import { listFormLeads, MetaGraphError } from "./meta-graph";
import { normalizeMetaFormLead, type MetaLeadgen } from "./normalize";
import { resolveLeadsToken } from "./routing";

export interface RecoveryFormResult {
  form_id: string;
  label: string | null;
  found: number;
  missing: MetaLeadgen[];
  imported: number;
  error?: string;
}

export interface RecoveryResult {
  forms: RecoveryFormResult[];
  totals: { forms: number; found: number; missing: number; imported: number };
  errors: Array<{ form_id: string; error: string }>;
}

const PER_FORM_LIMIT = 200;

/**
 * Roda a recuperação sobre TODOS os formulários que a empresa
 * cadastrou (`account_lead_sources`, kind='form_id').
 */
export async function runRecovery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  params: {
    accountId: string;
    days: number;
    mode: "scan" | "import";
    decrypt: (value: string) => string;
  },
): Promise<RecoveryResult> {
  const since = Math.floor(Date.now() / 1000) - params.days * 24 * 60 * 60;

  const { data: sources } = await admin
    .from("account_lead_sources")
    .select("value, label, meta_app_id")
    .eq("account_id", params.accountId)
    .eq("kind", "form_id")
    .eq("active", true);

  const forms: RecoveryFormResult[] = [];
  const errors: Array<{ form_id: string; error: string }> = [];

  for (const src of sources ?? []) {
    const formId = String(src.value);
    const entry: RecoveryFormResult = {
      form_id: formId,
      label: src.label ?? null,
      found: 0,
      missing: [],
      imported: 0,
    };

    const token = await resolveLeadsToken(
      admin,
      { metaAppId: src.meta_app_id, accountId: params.accountId },
      params.decrypt,
    );
    if (!token) {
      entry.error = "Nenhum token da Meta cadastrado para esta origem.";
      errors.push({ form_id: formId, error: entry.error });
      forms.push(entry);
      continue;
    }

    let remote: MetaLeadgen[];
    try {
      remote = await listFormLeads(token, formId, PER_FORM_LIMIT, since);
    } catch (err) {
      // Um formulário com token vencido não pode impedir a
      // recuperação dos outros — o erro fica visível por formulário.
      entry.error =
        err instanceof MetaGraphError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Falha ao consultar a Meta";
      errors.push({ form_id: formId, error: entry.error });
      forms.push(entry);
      continue;
    }

    entry.found = remote.length;
    if (remote.length === 0) {
      forms.push(entry);
      continue;
    }

    // Quais desses já existem aqui. Uma consulta por formulário, com
    // a lista de ids — não uma consulta por lead.
    const ids = remote.map((l) => l.id).filter(Boolean) as string[];
    const { data: known } = await admin
      .from("lead_ingestions")
      .select("meta_lead_id")
      .in("meta_lead_id", ids);

    const have = new Set((known ?? []).map((k) => k.meta_lead_id as string));
    entry.missing = remote.filter((l) => l.id && !have.has(l.id));

    if (params.mode === "import") {
      for (const leadgen of entry.missing) {
        try {
          const lead = normalizeMetaFormLead({
            webhook: {
              leadgen_id: leadgen.id,
              form_id: leadgen.form_id ?? formId,
              ad_id: leadgen.ad_id,
            },
            leadgen,
          });
          // O "raw" aqui é o que a Graph devolveu — não houve
          // webhook. Fica registrado como a origem real do dado.
          await ingestLead(admin, lead, {
            recovered_from: "graph_api",
            form_id: formId,
            leadgen,
          });
          entry.imported++;
        } catch (err) {
          console.error(
            "[leads/recovery] falha ao importar",
            leadgen.id,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    forms.push(entry);
  }

  return {
    forms,
    errors,
    totals: {
      forms: forms.length,
      found: forms.reduce((s, f) => s + f.found, 0),
      missing: forms.reduce((s, f) => s + f.missing.length, 0),
      imported: forms.reduce((s, f) => s + f.imported, 0),
    },
  };
}
