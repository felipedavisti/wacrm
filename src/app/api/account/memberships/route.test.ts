import { afterEach, describe, expect, it, vi } from "vitest";

// GET /api/account/memberships (spec 008): the switcher's data
// source. Pins: it answers in the "sem empresa" state (null + []),
// and the reported active id is always one that exists in the
// membership list (stale pointers degrade to the first membership).

let currentUser: { id: string } | null = null;
let profileRow: { account_id: string | null } | null = null;
let membershipRows: Array<Record<string, unknown>> = [];
let accountRows: Array<{ id: string; name: string }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentUser },
        error: null,
      }),
    },
    from: (table: string) => {
      const result = () => {
        switch (table) {
          case "profiles":
            return { data: profileRow, error: null };
          case "account_members":
            return { data: membershipRows, error: null };
          case "accounts":
            return { data: accountRows, error: null };
          default:
            return { data: null, error: null };
        }
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "in", "limit"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => result();
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(result()).then(resolve, reject);
      return builder;
    },
  }),
}));

const { GET } = await import("./route");

afterEach(() => {
  currentUser = null;
  profileRow = null;
  membershipRows = [];
  accountRows = [];
  vi.clearAllMocks();
});

describe("GET /api/account/memberships", () => {
  it("401 without a session", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("answers the 'sem empresa' state with null + empty list", async () => {
    currentUser = { id: "user-1" };
    profileRow = { account_id: null };
    membershipRows = [];

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      active_account_id: null,
      memberships: [],
    });
  });

  it("lists companies and reports the active one", async () => {
    currentUser = { id: "user-1" };
    profileRow = { account_id: "acct-2" };
    membershipRows = [
      { account_id: "acct-1", role: "owner", position: null },
      { account_id: "acct-2", role: "agent", position: "sdr" },
    ];
    accountRows = [
      { id: "acct-1", name: "Vitalmed Salvador" },
      { id: "acct-2", name: "Vitalmed São Luís" },
    ];

    const res = await GET();
    const body = await res.json();

    expect(body.active_account_id).toBe("acct-2");
    expect(body.memberships).toEqual([
      {
        account_id: "acct-1",
        account_name: "Vitalmed Salvador",
        role: "owner",
        position: null,
      },
      {
        account_id: "acct-2",
        account_name: "Vitalmed São Luís",
        role: "agent",
        position: "sdr",
      },
    ]);
  });

  it("degrades a stale active pointer to the first membership", async () => {
    currentUser = { id: "user-1" };
    // Points at a company the user no longer belongs to.
    profileRow = { account_id: "acct-gone" };
    membershipRows = [{ account_id: "acct-1", role: "owner", position: null }];
    accountRows = [{ id: "acct-1", name: "Vitalmed Salvador" }];

    const res = await GET();
    const body = await res.json();

    expect(body.active_account_id).toBe("acct-1");
  });
});
