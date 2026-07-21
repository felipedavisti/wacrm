// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's ACTIVE account. Any member can
// call it (the Members tab is shown to admins+, but agents/viewers
// see a read-only roster too).
//
// Multi-conta (spec 008): the roster comes from `account_members` —
// the source of truth of membership. It must NOT come from
// `profiles.account_id` anymore: that column is just the ACTIVE
// company pointer, so a teammate currently "switched into" another
// company would vanish from the roster.
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + position +
//   joined date only.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface MembershipRow {
  user_id: string;
  role: string;
  position: string | null;
  created_at: string;
}

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // Membership rows of the active account. RLS allows any member
    // of the account to read them (migration 508).
    const { data: rows, error } = await ctx.supabase
      .from("account_members")
      .select("user_id, role, position, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] membership fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const memberships = (rows ?? []) as MembershipRow[];
    if (memberships.length === 0) {
      return NextResponse.json({ members: [] });
    }

    // Hydrate identity from profiles by user id — a plain IN query,
    // not an embed (schema-cache lesson from #294). The profiles
    // SELECT policy (508) allows reading colleagues that share at
    // least one company with the caller.
    const userIds = memberships.map((m) => m.user_id);
    const { data: profs, error: profErr } = await ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url")
      .in("user_id", userIds);

    if (profErr) {
      console.error("[GET /api/account/members] profiles fetch error:", profErr);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const profileById = new Map(
      ((profs ?? []) as ProfileRow[]).map((p) => [p.user_id, p]),
    );

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = memberships.flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.role)) return [];
      const profile = profileById.get(row.user_id);
      return [
        {
          user_id: row.user_id,
          full_name: profile?.full_name ?? "",
          email: canSeeEmails ? (profile?.email ?? null) : null,
          avatar_url: profile?.avatar_url ?? null,
          role: row.role,
          position:
            row.position === "sdr" ||
            row.position === "closer" ||
            row.position === "vendedor"
              ? row.position
              : null,
          joined_at: row.created_at,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
