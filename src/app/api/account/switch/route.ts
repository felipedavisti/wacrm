import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

// Map SQLSTATEs raised by set_active_account (migration 510) onto
// HTTP statuses — same convention as the member-management routes.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[account switch] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to switch account" },
    { status: 500 },
  );
}

// POST /api/account/switch (spec 008, FR-011)
//
// Switches the caller's ACTIVE company. The authorization decision
// lives in the set_active_account RPC (SECURITY DEFINER): it refuses
// any account the caller has no membership in (42501 → 403), so a
// forged account_id can never be activated. Not gated on
// getCurrentAccount() — a user whose active pointer is broken must
// still be able to switch out of it.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const accountId = body?.account_id;
    if (typeof accountId !== "string" || accountId.length === 0) {
      return NextResponse.json(
        { error: "account_id is required" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc("set_active_account", {
      p_account_id: accountId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ active_account_id: data });
  } catch (err) {
    console.error("[account switch] error:", err);
    return NextResponse.json(
      { error: "Failed to switch account" },
      { status: 500 },
    );
  }
}
