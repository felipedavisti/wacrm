import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/leads/unrouted/resolve — a ÚNICA rota do produto que
// atravessa empresas. Ela pega leads que não pertencem a ninguém e
// os entrega a uma conta.
//
// A revisão de segurança apontou o risco: quem chega primeiro fica
// com a origem. Estes testes travam as duas defesas que impedem o
// pior caso — direcionar lead para empresa alheia, e roubar uma
// origem que já tem dono.

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

const calls: Call[] = [];
const inserts: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];
const enqueued: string[] = [];

let ownedAccountIds: string[] = ["acct-mine"];
/** Erro devolvido pelo INSERT da origem (23505 = já cadastrada). */
let insertError: { code: string } | null = null;
/** Dono atual da origem, consultado no caminho do 23505. */
let existingOwner: { account_id: string } | null = null;
let pendingLeads: Array<{ id: string; canonical: unknown }> = [];

vi.mock("@/lib/auth/deployment-admin", () => ({
  requireDeploymentAdmin: async () => ({
    userId: "user-1",
    ownedAccountIds,
  }),
}));

vi.mock("@/lib/auth/account", () => ({
  toErrorResponse: (err: unknown) => {
    throw err;
  },
}));

vi.mock("@/lib/leads/ingest", () => ({
  enqueueDelivery: async (_admin: unknown, id: string) => {
    enqueued.push(id);
  },
}));

vi.mock("@/lib/leads/admin-client", () => ({
  supabaseAdmin: () => {
    let table = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    const record =
      (op: string) =>
      (...args: unknown[]) => {
        calls.push({ table, op, args });
        return chain;
      };
    chain.from = (t: string) => {
      table = t;
      return chain;
    };
    for (const m of ["select", "eq", "ilike", "in", "limit"]) chain[m] = record(m);
    chain.insert = async (payload: Record<string, unknown>) => {
      inserts.push(payload);
      return { error: insertError };
    };
    chain.update = (payload: Record<string, unknown>) => {
      updates.push(payload);
      return chain;
    };
    chain.maybeSingle = async () => ({ data: existingOwner, error: null });
    chain.then = (
      res: (v: unknown) => unknown,
      rej: (e: unknown) => unknown,
    ) =>
      Promise.resolve(
        table === "lead_ingestions"
          ? { data: pendingLeads, error: null }
          : { data: null, error: null },
      ).then(res, rej);
    return chain;
  },
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("http://test/api/leads/unrouted/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  ownedAccountIds = ["acct-mine"];
  insertError = null;
  existingOwner = null;
  pendingLeads = [];
});

afterEach(() => {
  calls.length = 0;
  inserts.length = 0;
  updates.length = 0;
  enqueued.length = 0;
  vi.clearAllMocks();
});

describe("POST /api/leads/unrouted/resolve", () => {
  it("403 ao direcionar lead para empresa que o chamador NÃO possui", async () => {
    const res = await POST(
      post({ kind: "filial", value: "Recife", account_id: "acct-de-outro" }),
    );

    expect(res.status).toBe(403);
    // Nada pode ter acontecido antes do 403.
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("409 quando a origem já pertence a outra empresa (não se rouba cadastro)", async () => {
    insertError = { code: "23505" };
    existingOwner = { account_id: "acct-de-outro" };

    const res = await POST(
      post({ kind: "form_id", value: "123", account_id: "acct-mine" }),
    );

    expect(res.status).toBe(409);
    // O ponto do 409: os leads NÃO são adotados.
    expect(updates).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it("segue quando o 23505 é da própria empresa (idempotente)", async () => {
    insertError = { code: "23505" };
    existingOwner = { account_id: "acct-mine" };
    pendingLeads = [
      { id: "ing-1", canonical: { routingKey: { kind: "filial", value: "Recife" } } },
    ];

    const res = await POST(
      post({ kind: "filial", value: "Recife", account_id: "acct-mine" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: 1, registered: true });
  });

  it("IGNORA meta_app_id do corpo (id não verificado escolheria token alheio)", async () => {
    await POST(
      post({
        kind: "form_id",
        value: "123",
        account_id: "acct-mine",
        meta_app_id: "app-de-outra-empresa",
      }),
    );

    expect(inserts[0]).toMatchObject({ meta_app_id: null });
  });

  it("adota só os leads da chave pedida, e casa sem diferenciar caixa", async () => {
    pendingLeads = [
      { id: "ing-1", canonical: { routingKey: { kind: "filial", value: "RECIFE" } } },
      { id: "ing-2", canonical: { routingKey: { kind: "filial", value: "Fortaleza" } } },
      { id: "ing-3", canonical: { routingKey: { kind: "form_id", value: "recife" } } },
    ];

    const res = await POST(
      post({ kind: "filial", value: "recife", account_id: "acct-mine" }),
    );

    expect(await res.json()).toEqual({ adopted: 1, registered: true });
    expect(updates[0]).toMatchObject({
      account_id: "acct-mine",
      routing_status: "resolved",
    });
    expect(enqueued).toEqual(["ing-1"]);
  });

  it("só mexe em lead ÓRFÃO — nunca em um que já tem dono", async () => {
    pendingLeads = [];

    await POST(post({ kind: "filial", value: "Recife", account_id: "acct-mine" }));

    expect(
      calls.some(
        (c) =>
          c.table === "lead_ingestions" &&
          c.op === "eq" &&
          c.args[0] === "routing_status" &&
          c.args[1] === "pending",
      ),
    ).toBe(true);
  });

  it("400 sem account_id, antes de qualquer escrita", async () => {
    const res = await POST(post({ kind: "filial", value: "Recife" }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});
