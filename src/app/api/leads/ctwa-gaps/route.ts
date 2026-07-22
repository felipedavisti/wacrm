// ============================================================
// GET /api/leads/ctwa-gaps — conversa de anúncio que NÃO virou lead
// (spec 010).
//
// Um lead de Site que falha aparece como "Falhou" no painel. Um lead
// de CTWA que falha não aparece em lugar nenhum: a conversa está lá,
// bonita, na inbox — e o negócio simplesmente não existe. É a falha
// mais perigosa das três origens, porque parece sucesso.
//
// Esta rota fecha esse buraco: toda conversa com referral capturado
// que não tem lead correspondente. Se o número aqui for > 0, alguma
// coisa quebrou entre a captura e a criação do negócio.
//
// Acesso: owner da empresa ativa, como o resto do painel.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("owner");
    const { searchParams } = new URL(request.url);

    const rawDays = Number(searchParams.get("days") ?? "30");
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    // 1) Conversas com anúncio capturado no período.
    const { data: referrals, error: refErr } = await ctx.supabase
      .from("ctwa_referrals")
      .select(
        "conversation_id, contact_id, campaign_name, source_id, headline, created_at",
      )
      .eq("account_id", ctx.accountId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);

    if (refErr) {
      console.error("[GET /api/leads/ctwa-gaps] referral fetch error:", refErr);
      return NextResponse.json(
        { error: "Failed to load CTWA referrals" },
        { status: 500 },
      );
    }

    const rows = referrals ?? [];
    if (rows.length === 0) {
      return NextResponse.json({ days, total_conversations: 0, gaps: [] });
    }

    // Uma conversa pode ter vários referrals (o cliente clica em dois
    // anúncios). A unidade aqui é a CONVERSA — o lead é um por
    // conversa, então contar referral inflaria a lacuna.
    const byConversation = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!r.conversation_id) continue;
      if (!byConversation.has(r.conversation_id)) {
        byConversation.set(r.conversation_id, r);
      }
    }
    const conversationIds = [...byConversation.keys()];

    // 2) Quais dessas já têm lead. Uma consulta só, pelo vínculo real
    //    (migration 519) — nada de parse de dedup_key.
    const { data: leads, error: leadErr } = await ctx.supabase
      .from("lead_ingestions")
      .select("conversation_id")
      .eq("account_id", ctx.accountId)
      .in("conversation_id", conversationIds);

    if (leadErr) {
      console.error("[GET /api/leads/ctwa-gaps] lead fetch error:", leadErr);
      return NextResponse.json(
        { error: "Failed to load leads" },
        { status: 500 },
      );
    }

    const withLead = new Set(
      (leads ?? []).map((l) => l.conversation_id as string),
    );

    const gaps = conversationIds
      .filter((id) => !withLead.has(id))
      .map((id) => {
        const r = byConversation.get(id)!;
        return {
          conversation_id: id,
          contact_id: r.contact_id,
          campaign_name: r.campaign_name,
          headline: r.headline,
          source_id: r.source_id,
          created_at: r.created_at,
        };
      });

    return NextResponse.json({
      days,
      total_conversations: conversationIds.length,
      gaps,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
