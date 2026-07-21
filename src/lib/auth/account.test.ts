import { afterEach, describe, expect, it, vi } from "vitest";

// getCurrentAccount resolves the caller's account context. The
// regression this file guards (issue #294): account loading must NOT
// depend on a PostgREST embedded FK join (`accounts!inner`), because a
// stale schema cache makes that embed fail hard and blanks the whole
// context. It must instead read the profile and then the account with
// two plain point queries.

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
  /** Payload passed to .update(), when this call was a write. */
  update?: unknown;
}

// `byTable[table]` may be a single result (reused for every query on
// that table) or an array consumed in order — needed since spec 008,
// where `profiles` can be read and then updated (self-heal) in one
// getCurrentAccount call.
type QueuedResult = { data: unknown; error: unknown };

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<string, QueuedResult | QueuedResult[]>;
  rpcResult?: QueuedResult;
}) {
  const calls: BuilderCall[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  const nextResult = (table: string): QueuedResult => {
    const queued = opts.byTable[table];
    if (Array.isArray(queued)) {
      return queued.shift() ?? { data: null, error: null };
    }
    return queued ?? { data: null, error: null };
  };

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      update(payload: unknown) {
        call.update = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(nextResult(table));
      },
      // Awaited update chains (`await ...update().eq()`) land here.
      then(
        resolve: (v: QueuedResult) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(nextResult(table)).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    calls,
    rpcCalls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
      rpc: (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve(opts.rpcResult ?? { data: null, error: null });
      },
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { getCurrentAccount, UnauthorizedError, ForbiddenError, NoAccountError } =
  await import("./account");

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves context via a plain accounts lookup, not an embedded join", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(["profiles", "accounts"]);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([["user_id", "user-1"]]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([["id", "acct-1"]]);
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Could not load account context",
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "admin" },
          error: null,
        },
        accounts: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Could not load account context");
  });

  // ------------------------------------------------------------
  // Spec 008 (multi-conta): NULL active-account pointer.
  // ------------------------------------------------------------

  it("throws NoAccountError when the user has no memberships at all", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: null, account_role: null }, error: null },
        account_members: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(NoAccountError);
    // Still a ForbiddenError for every existing API route (403).
    expect(err).toBeInstanceOf(ForbiddenError);
    // It looked for a fallback membership before giving up.
    expect(calls.map((c) => c.table)).toEqual(["profiles", "account_members"]);
  });

  it("self-heals a NULL pointer by activating the earliest membership", async () => {
    const { client, rpcCalls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        // Pointer is NULL (active company deleted/revoked).
        profiles: { data: { account_id: null, account_role: null }, error: null },
        account_members: {
          data: { account_id: "acct-2", role: "agent" },
          error: null,
        },
        accounts: { data: { id: "acct-2", name: "Filial 2" }, error: null },
      },
      rpcResult: { data: "acct-2", error: null },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      accountId: "acct-2",
      role: "agent",
      account: { id: "acct-2", name: "Filial 2" },
    });
    // The heal goes through the sanctioned RPC — never a direct
    // profiles UPDATE (the 508 guard trigger forbids it).
    expect(rpcCalls).toEqual([
      { fn: "set_active_account", args: { p_account_id: "acct-2" } },
    ]);
  });

  it("rejects a missing profile row as a plain ForbiddenError", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err).not.toBeInstanceOf(NoAccountError);
    expect(err.message).toBe("Profile is not linked to an account");
  });

  it("rejects an account_id that resolves to no readable account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "viewer" },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });
});
