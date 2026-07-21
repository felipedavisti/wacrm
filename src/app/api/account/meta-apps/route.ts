// ============================================================
// /api/account/meta-apps (spec 009)
//
//   GET   — Apps da Meta da empresa ativa, SEM segredos: devolve só
//           se o token de leads existe (`has_leads_token`), nunca o
//           valor. Segredo que sai do servidor é segredo vazado.
//   PATCH — grava o token de leads de um App (admin+), criptografado
//           AES-256-GCM com a ENCRYPTION_KEY, como o app_secret.
//
// O cadastro do App em si (app_id/app_secret) continua em
// Settings → WhatsApp (spec 007) — aqui só se acrescenta a
// capacidade de ler leads.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const { data, error } = await ctx.supabase
      .from("meta_apps")
      .select("id, app_id, leads_access_token")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/meta-apps] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load Meta Apps" },
        { status: 500 },
      );
    }

    // Nunca devolver o ciphertext: só o fato de existir.
    const apps = (data ?? []).map(
      (a: { id: string; app_id: string; leads_access_token: string | null }) => ({
        id: a.id,
        app_id: a.app_id,
        has_leads_token: !!a.leads_access_token,
      }),
    );

    return NextResponse.json({ apps });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      leads_access_token?: unknown;
    } | null;

    const id = body?.id;
    const token = body?.leads_access_token;
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "'id' is required" }, { status: 400 });
    }
    if (typeof token !== "string" || token.trim() === "") {
      return NextResponse.json(
        { error: "'leads_access_token' is required" },
        { status: 400 },
      );
    }

    let ciphertext: string;
    try {
      ciphertext = encrypt(token.trim());
    } catch (err) {
      console.error("[PATCH /api/account/meta-apps] encrypt failed:", err);
      return NextResponse.json(
        { error: "Failed to encrypt the token" },
        { status: 500 },
      );
    }

    // `.eq('account_id')` é o que impede gravar no App de outra
    // empresa mesmo adivinhando o id.
    const { error } = await ctx.supabase
      .from("meta_apps")
      .update({ leads_access_token: ciphertext })
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[PATCH /api/account/meta-apps] update error:", error);
      return NextResponse.json(
        { error: "Failed to save the token" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
