// ============================================================
// Chaves de deduplicação (spec 009, FR-017/018/019).
//
// Duas garantias distintas, deliberadamente:
//
//   Idempotência (Meta)  — `meta_lead_id` com índice UNIQUE. É
//     absoluta e vive no BANCO: reentrega do webhook e recuperação
//     ativa (011) convergem sem duplicar, mesmo em corrida.
//
//   Dedup por origem     — `dedup_key`, aplicada por consulta:
//     Site: mesma pessoa + mesmo produto dentro de 24h;
//     Meta: mesma pessoa + mesmo formulário, SEM janela.
//
// Deduplicar nunca é descartar: o evento suprimido é gravado e
// vinculado ao lead original (FR-020).
//
// Módulo puro (sem I/O) — testável isoladamente.
// ============================================================

import { createHash } from "node:crypto";

import type { CanonicalLead } from "./canonical";

/** Janela de dedup do site (FR-017). Depois disso é lead novo. */
export const SITE_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function hash(parts: Array<string | undefined>): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Chave de dedup do lead, ou null quando não há identidade
 * suficiente para deduplicar com segurança (nesse caso o lead é
 * criado — errar para o lado de não perder, FR-010).
 *
 * Site: o `cpf` é o identificador mais forte e vence quando existe;
 * sem ele, cai para telefone+email. O produto entra sempre — a
 * mesma pessoa pedindo simulação de DOIS planos são dois leads.
 *
 * Meta: formulário + pessoa. O mesmo contato no MESMO formulário não
 * duplica; em formulários diferentes gera leads distintos (FR-019).
 */
export function buildDedupKey(lead: CanonicalLead): string | null {
  const { contact } = lead;

  if (lead.source === "site") {
    const identity = contact.cpf
      ? `cpf:${contact.cpf}`
      : contact.phone || contact.email
        ? `pe:${contact.phone ?? ""}:${contact.email ?? ""}`
        : null;
    if (!identity) return null;
    return hash(["site", identity, lead.product ?? ""]);
  }

  if (lead.source === "meta_form") {
    const formId = lead.tracking.form_id;
    if (!formId) return null;
    if (!contact.phone && !contact.email) return null;
    return hash([
      "meta_form",
      formId,
      contact.phone ?? "",
      contact.email ?? "",
    ]);
  }

  // CTWA (010) dedupa por conversa, não por chave de conteúdo.
  return null;
}

/**
 * Instante a partir do qual um lead com a mesma chave conta como
 * duplicado. `null` = sem janela (qualquer lead anterior duplica —
 * é o caso da Meta).
 */
export function dedupWindowStart(
  lead: CanonicalLead,
  now: Date = new Date(),
): Date | null {
  if (lead.source === "site") {
    return new Date(now.getTime() - SITE_DEDUP_WINDOW_MS);
  }
  return null;
}
