// ============================================================
// /api/account/lead-sources (spec 009, migration 517)
//
//   GET  — origens de lead da empresa ativa (qualquer membro)
//   POST — cadastra uma origem                (admin+)
//
// É o equivalente, para captação de leads, do cadastro de números do
// WhatsApp: a empresa declara os formulários da Meta e as filiais do
// site que são dela, e a ingestão resolve a conta a partir disso.
//
// O UNIQUE global em (kind, lower(value)) é a proteção contra duas
// empresas reivindicarem o mesmo formulário — mesma garantia que
// `whatsapp_config.phone_number_id` tem. Uma colisão vira 409, não
// um 500 opaco.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";

const KINDS = new Set(["form_id", "filial"]);

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("account_lead_sources")
      .select(
        "id, kind, value, label, active, meta_app_id, pipeline_id, stage_id, created_at",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/lead-sources] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load lead sources" },
        { status: 500 },
      );
    }

    return NextResponse.json({ sources: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as {
      kind?: unknown;
      value?: unknown;
      label?: unknown;
      meta_app_id?: unknown;
      pipeline_id?: unknown;
      stage_id?: unknown;
    } | null;

    const kind = body?.kind;
    if (typeof kind !== "string" || !KINDS.has(kind)) {
      return NextResponse.json(
        { error: "'kind' must be one of form_id, filial" },
        { status: 400 },
      );
    }

    const value = typeof body?.value === "string" ? body.value.trim() : "";
    if (!value) {
      return NextResponse.json({ error: "'value' is required" }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from("account_lead_sources")
      .insert({
        account_id: ctx.accountId,
        kind,
        value,
        label: typeof body?.label === "string" ? body.label.trim() || null : null,
        meta_app_id:
          typeof body?.meta_app_id === "string" ? body.meta_app_id : null,
        pipeline_id:
          typeof body?.pipeline_id === "string" ? body.pipeline_id : null,
        stage_id: typeof body?.stage_id === "string" ? body.stage_id : null,
      })
      .select("id, kind, value, label, active, meta_app_id, pipeline_id, stage_id")
      .single();

    if (error) {
      // 23505 = o UNIQUE global. Outra empresa (ou esta mesma) já
      // reivindicou este formulário/filial — precisa de uma mensagem
      // clara, não de um 500.
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "Esta origem já está cadastrada — um formulário ou filial só pode pertencer a uma empresa.",
          },
          { status: 409 },
        );
      }
      console.error("[POST /api/account/lead-sources] insert error:", error);
      return NextResponse.json(
        { error: "Failed to create lead source" },
        { status: 500 },
      );
    }

    return NextResponse.json({ source: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
