// ============================================================
// Membership listing for the account switcher (spec 008).
//
// Server-only module (same boundary as ./account): reads the
// caller's rows from `account_members` and hydrates account names
// with a second plain query — deliberately NOT a PostgREST embedded
// join, for the same schema-cache-staleness reason documented on
// getCurrentAccount (issue #294): right after a migration adds the
// FK, the embed can fail hard; two point queries never do.
//
// RLS does the heavy lifting: `account_members` SELECT allows only
// the caller's own rows (or admins of the account), and `accounts`
// SELECT allows only accounts the caller is a member of — so this
// module cannot leak another user's companies by construction.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountRole, SalesPosition } from "./roles";

/** One entry of the company switcher: a company the user belongs to. */
export interface MembershipSummary {
  account_id: string;
  account_name: string;
  role: AccountRole;
  position: SalesPosition | null;
}

/**
 * List every company the user belongs to, oldest membership first
 * (stable order for the switcher). Returns [] for the "sem empresa"
 * state — callers decide how to render that.
 */
export async function listMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<MembershipSummary[]> {
  const { data: rows, error } = await supabase
    .from("account_members")
    .select("account_id, role, position, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[listMemberships] account_members fetch error:", error);
    throw new Error("Could not load memberships");
  }
  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.account_id);
  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, name")
    .in("id", ids);

  if (accErr) {
    console.error("[listMemberships] accounts fetch error:", accErr);
    throw new Error("Could not load memberships");
  }

  const nameById = new Map(
    (accounts ?? []).map((a: { id: string; name: string }) => [a.id, a.name]),
  );

  return rows.map((r) => ({
    account_id: r.account_id,
    // An account the RLS hid (shouldn't happen — membership implies
    // visibility) degrades to an id-labelled entry rather than a crash.
    account_name: nameById.get(r.account_id) ?? r.account_id,
    role: r.role,
    position: r.position ?? null,
  }));
}
