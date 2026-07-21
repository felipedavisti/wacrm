// DELETE /api/account/lead-sources/[id] — remove uma origem de lead
// da empresa ativa (admin+). O `.eq('account_id')` é o que impede
// remover a origem de outra empresa mesmo adivinhando o id.

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const { error } = await ctx.supabase
      .from("account_lead_sources")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/account/lead-sources] error:", error);
      return NextResponse.json(
        { error: "Failed to remove lead source" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
