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
        "id, kind, value, label, active, meta_app_id, pipeline_id, stage_id, created_at, welcome_enabled, welcome_template_name, welcome_template_language",
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

// PATCH — liga/desliga a saudação automática de UMA origem (FR-047).
//
// Por origem, e não por empresa: filiais têm operações diferentes, e
// uma pode querer automatizar enquanto a outra prefere ligar antes.
// Ligar sem informar o template é recusado aqui e no banco (CHECK) —
// seria uma origem que tenta enviar e falha em toda entrega.
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      welcome_enabled?: unknown;
      welcome_template_name?: unknown;
      welcome_template_language?: unknown;
    } | null;

    const id = body?.id;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "'id' is required" }, { status: 400 });
    }

    const enabled = body?.welcome_enabled === true;
    const templateName =
      typeof body?.welcome_template_name === "string"
        ? body.welcome_template_name.trim()
        : "";

    if (enabled && !templateName) {
      return NextResponse.json(
        {
          error:
            "Informe o nome do template aprovado antes de ligar a saudação automática.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("account_lead_sources")
      .update({
        welcome_enabled: enabled,
        welcome_template_name: templateName || null,
        welcome_template_language:
          typeof body?.welcome_template_language === "string" &&
          body.welcome_template_language.trim()
            ? body.welcome_template_language.trim()
            : "pt_BR",
      })
      .eq("id", id)
      // Defesa em profundidade: o RLS já limita à empresa ativa, mas
      // uma escrita cruzada não pode depender só disso.
      .eq("account_id", ctx.accountId)
      .select(
        "id, welcome_enabled, welcome_template_name, welcome_template_language",
      )
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/account/lead-sources] update error:", error);
      return NextResponse.json(
        { error: "Failed to update lead source" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ source: data });
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

    // O `meta_app_id` decide qual token da Meta enriquece esta origem,
    // e esse token é lido depois com service_role. Um id de App de
    // OUTRA empresa faria a nossa ingestão rodar com a credencial
    // dela — então a posse é verificada aqui, na entrada, e não
    // apenas assumida. A FK sozinha não olha o dono.
    const metaAppId =
      typeof body?.meta_app_id === "string" && body.meta_app_id
        ? body.meta_app_id
        : null;
    if (metaAppId) {
      const { data: app } = await ctx.supabase
        .from("meta_apps")
        .select("id")
        .eq("id", metaAppId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!app) {
        return NextResponse.json(
          { error: "O App da Meta informado não pertence a esta empresa." },
          { status: 400 },
        );
      }
    }

    const { data, error } = await ctx.supabase
      .from("account_lead_sources")
      .insert({
        account_id: ctx.accountId,
        kind,
        value,
        label: typeof body?.label === "string" ? body.label.trim() || null : null,
        meta_app_id: metaAppId,
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
