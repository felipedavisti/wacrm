// ============================================================
// POST /api/leads/recovery — recuperação ativa (spec 011, US1)
//
// Pergunta à Meta o que existe no período e compara com o que temos.
// `mode: 'scan'` só mostra; `mode: 'import'` cria os ausentes.
//
// Acesso: owner da empresa ativa — importar lead é criar
// oportunidade comercial retroativa, e roda com service_role.
//
// Toda execução é auditada (FR-026), inclusive o scan: saber que
// alguém conferiu e não achou nada também é informação.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/leads/admin-client";
import { runRecovery } from "@/lib/leads/recovery";
import { decrypt } from "@/lib/whatsapp/encryption";

const MAX_DAYS = 90;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string;
      days?: number;
    };

    const mode = body.mode === "import" ? "import" : "scan";
    const rawDays = Number(body.days ?? 7);
    // Teto de 90 dias: a Graph pagina e o operador espera. Um pedido
    // de "tudo desde sempre" viraria um timeout silencioso.
    const days =
      Number.isFinite(rawDays) && rawDays > 0
        ? Math.min(Math.floor(rawDays), MAX_DAYS)
        : 7;

    const admin = supabaseAdmin();
    const result = await runRecovery(admin, {
      accountId: ctx.accountId,
      days,
      mode,
      decrypt,
    });

    // Auditoria antes de responder: se a gravação falhar, queremos
    // saber pelo log — mas não desfazer uma importação já feita.
    const { error: auditErr } = await admin.from("lead_recovery_runs").insert({
      account_id: ctx.accountId,
      run_by: ctx.userId,
      mode,
      days,
      forms_checked: result.totals.forms,
      found: result.totals.found,
      missing: result.totals.missing,
      imported: result.totals.imported,
      errors: result.errors.length > 0 ? result.errors : null,
    });
    if (auditErr) {
      console.error("[POST /api/leads/recovery] audit insert failed:", auditErr);
    }

    return NextResponse.json({
      mode,
      days,
      totals: result.totals,
      // O payload completo dos ausentes não volta: só o que a tela
      // precisa mostrar. Devolver o field_data de 200 leads seria
      // despejar PII numa resposta que ninguém lê.
      forms: result.forms.map((f) => ({
        form_id: f.form_id,
        label: f.label,
        found: f.found,
        missing: f.missing.length,
        imported: f.imported,
        error: f.error ?? null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
