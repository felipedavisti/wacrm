import { afterEach, describe, expect, it, vi } from "vitest";

// POST /api/account/switch (spec 008): the route is a thin shell over
// the set_active_account RPC — these tests pin the contract: auth
// gate, input validation, SQLSTATE→HTTP mapping (42501 → 403 so a
// forged account_id can never be activated), and the success shape.

let currentUser: { id: string } | null = null;
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentUser },
        error: null,
      }),
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));

const { POST } = await import("./route");

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/account/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  currentUser = null;
  rpcResult = { data: null, error: null };
  rpcCalls.length = 0;
  vi.clearAllMocks();
});

describe("POST /api/account/switch", () => {
  it("401 without a session", async () => {
    currentUser = null;
    const res = await POST(makeRequest({ account_id: "acct-2" }));
    expect(res.status).toBe(401);
  });

  it("400 without an account_id", async () => {
    currentUser = { id: "user-1" };
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("403 when the RPC refuses a non-member account (42501)", async () => {
    currentUser = { id: "user-1" };
    rpcResult = {
      data: null,
      error: { code: "42501", message: "You are not a member of this account" },
    };
    const res = await POST(makeRequest({ account_id: "acct-other" }));
    expect(res.status).toBe(403);
  });

  it("switches and returns the activated account id", async () => {
    currentUser = { id: "user-1" };
    rpcResult = { data: "acct-2", error: null };

    const res = await POST(makeRequest({ account_id: "acct-2" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active_account_id: "acct-2" });
    expect(rpcCalls).toEqual([
      { fn: "set_active_account", args: { p_account_id: "acct-2" } },
    ]);
  });
});
