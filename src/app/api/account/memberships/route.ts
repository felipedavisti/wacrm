import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listMemberships } from "@/lib/auth/memberships";

// GET /api/account/memberships (spec 008)
//
// The companies the caller belongs to + which one is active — the
// data behind the account switcher. Deliberately does NOT go through
// getCurrentAccount(): this route must answer even in the "sem
// empresa" state (no memberships), where the switcher/no-company
// screen still needs `{ active_account_id: null, memberships: [] }`.
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const memberships = await listMemberships(supabase, user.id);

    // The active pointer may be stale/NULL (company deleted, revoked
    // mid-session). getCurrentAccount self-heals on the next scoped
    // request; here we just report a pointer that is actually in the
    // membership list, falling back to the first one.
    const active =
      memberships.find((m) => m.account_id === profile?.account_id)
        ?.account_id ??
      memberships[0]?.account_id ??
      null;

    return NextResponse.json({
      active_account_id: active,
      memberships,
    });
  } catch (err) {
    console.error("[memberships GET] error:", err);
    return NextResponse.json(
      { error: "Failed to load memberships" },
      { status: 500 },
    );
  }
}
