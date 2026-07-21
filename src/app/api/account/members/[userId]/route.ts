// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role and/or sales position. Admin+.
//   DELETE — remove a member.                                Admin+.
//
// Both delegate to SECURITY DEFINER RPCs (rewritten for multi-conta
// in migration 510):
//   - set_member_role(p_user_id, p_new_role)
//   - set_member_position(p_user_id, p_position)   (spec 008, FR-022)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+ IN THE ACTIVE ACCOUNT (checked against account_members),
// target must be a member of it, target can't be the owner, can't
// be self (role/removal). The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole, isSalesPosition } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; position?: unknown }
      | null;
    const role = body?.role;
    const hasRole = role !== undefined;
    // `position` is tri-state: absent = untouched; null = clear;
    // 'sdr'|'closer'|'vendedor' = set. (spec 008, FR-022)
    const hasPosition = body !== null && "position" in body;
    const position = body?.position ?? null;

    if (!hasRole && !hasPosition) {
      return NextResponse.json(
        { error: "Provide 'role' and/or 'position'" },
        { status: 400 },
      );
    }

    if (hasRole) {
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      // The RPC blocks promotion to / demotion from owner, but
      // surface the friendlier 400 before crossing the wire too.
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });
      if (error) return rpcErrorToResponse(error);
    }

    if (hasPosition) {
      if (position !== null && !isSalesPosition(position)) {
        return NextResponse.json(
          { error: "'position' must be one of sdr, closer, vendedor, or null" },
          { status: 400 },
        );
      }

      const { error } = await ctx.supabase.rpc("set_member_position", {
        p_user_id: userId,
        p_position: position,
      });
      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    // Multi-conta (510): removal just drops the membership — the
    // removed user keeps their other companies (no more "fresh
    // personal account"), so there is no id to return.
    const { error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
