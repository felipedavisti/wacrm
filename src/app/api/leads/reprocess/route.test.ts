import { afterEach, describe, expect, it, vi } from "vitest";

// POST /api/leads/reprocess — o botão "Reenviar" do painel.
//
// Estes testes existem porque o PO achou DOIS bugs aqui em dois
// cliques, e ambos eram silenciosos:
//
//   1. as escritas iam pelo cliente RLS, e as duas tabelas são
//      select-only por design: o UPDATE afetava zero linhas sem
//      erro nenhum, e a rota respondia `requeued: 0` como se não
//      houvesse o que reprocessar;
//   2. o status do lead era marcado como "pendente" para TODOS os
//      ids pedidos — inclusive os já entregues, cuja perna o filtro
//      corretamente ignora. O lead entregue passava a dizer "Na
//      fila" para sempre, sem trabalho pendente que o resolvesse.
//
// Nenhum dos dois dá erro. É exatamente o tipo de falha que só um
// teste pega.

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

const adminCalls: Call[] = [];
const rlsCalls: Call[] = [];

/** Resultado do UPDATE em lead_delivery_jobs (o que "reabriu"). */
let reopenedRows: Array<{ id: string; ingestion_id: string }> = [];
/** Ids que o caminho `all_failed` acha via cliente RLS. */
let failedIds: Array<{ id: string }> = [];

function makeChain(log: Call[], resultFor: (table: string) => unknown) {
  let table = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      log.push({ table, op, args });
      return chain;
    };
  chain.from = (t: string) => {
    table = t;
    log.push({ table: t, op: "from", args: [] });
    return chain;
  };
  for (const m of ["select", "update", "in", "eq", "gte", "order", "limit"]) {
    chain[m] = record(m);
  }
  // Torna a cadeia "awaitable", como o supabase-js.
  chain.then = (
    res: (v: unknown) => unknown,
    rej: (e: unknown) => unknown,
  ) => Promise.resolve(resultFor(table)).then(res, rej);
  return chain;
}

vi.mock("@/lib/leads/admin-client", () => ({
  supabaseAdmin: () =>
    makeChain(adminCalls, (table) =>
      table === "lead_delivery_jobs"
        ? { data: reopenedRows, error: null }
        : { data: null, error: null },
    ),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async () => ({
    accountId: "acct-1",
    userId: "user-1",
    supabase: makeChain(rlsCalls, () => ({ data: failedIds, error: null })),
  }),
  toErrorResponse: (err: unknown) => {
    throw err;
  },
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("http://test/api/leads/reprocess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** As chamadas de UPDATE feitas numa tabela, por qualquer cliente. */
function updatesOn(log: Call[], table: string) {
  return log.filter((c) => c.table === table && c.op === "update");
}

afterEach(() => {
  adminCalls.length = 0;
  rlsCalls.length = 0;
  reopenedRows = [];
  failedIds = [];
  vi.clearAllMocks();
});

describe("POST /api/leads/reprocess", () => {
  it("escreve via service_role, nunca pelo cliente RLS (as tabelas são select-only)", async () => {
    reopenedRows = [{ id: "job-1", ingestion_id: "ing-1" }];

    const res = await POST(post({ ids: ["ing-1"] }));
    expect(res.status).toBe(200);

    // Se voltar a escrever pelo cliente RLS, o UPDATE afeta zero
    // linhas em silêncio e o reenvio volta a não funcionar.
    expect(updatesOn(rlsCalls, "lead_delivery_jobs")).toHaveLength(0);
    expect(updatesOn(rlsCalls, "lead_ingestions")).toHaveLength(0);
    expect(updatesOn(adminCalls, "lead_delivery_jobs")).toHaveLength(1);
  });

  it("reabre a perna e devolve quantas voltaram para a fila", async () => {
    reopenedRows = [
      { id: "job-1", ingestion_id: "ing-1" },
      { id: "job-2", ingestion_id: "ing-2" },
    ];

    const res = await POST(post({ ids: ["ing-1", "ing-2"] }));
    expect(await res.json()).toEqual({ requeued: 2 });

    // Só o que NÃO está em curso é reaberto.
    const statusFilter = adminCalls.find(
      (c) =>
        c.table === "lead_delivery_jobs" &&
        c.op === "in" &&
        c.args[0] === "status",
    );
    expect(statusFilter?.args[1]).toEqual(["failed", "pending"]);
  });

  it("lead JÁ ENTREGUE: não reabre nada e NÃO o marca como 'na fila'", async () => {
    // A perna está 'succeeded', então o filtro não a reabre.
    reopenedRows = [];

    const res = await POST(post({ ids: ["ing-entregue"] }));
    expect(await res.json()).toEqual({ requeued: 0 });

    // O bug: marcava o lead entregue como pendente, e ele ficava
    // dizendo "Na fila" para sempre — sem trabalho para o worker.
    expect(updatesOn(adminCalls, "lead_ingestions")).toHaveLength(0);
  });

  it("marca como pendente SÓ os leads cuja perna realmente reabriu", async () => {
    // Pediu três; só um estava em estado reabrível.
    reopenedRows = [{ id: "job-2", ingestion_id: "ing-2" }];

    await POST(post({ ids: ["ing-1", "ing-2", "ing-3"] }));

    const idFilter = adminCalls.find(
      (c) => c.table === "lead_ingestions" && c.op === "in",
    );
    expect(idFilter?.args[1]).toEqual(["ing-2"]);
  });

  it("escopa toda escrita na empresa da SESSÃO, não em algo do corpo", async () => {
    reopenedRows = [{ id: "job-1", ingestion_id: "ing-1" }];

    // Um id de outra empresa forjado no corpo não deve escapar do
    // filtro de conta — é ele que impede reprocessar lead alheio.
    await POST(post({ ids: ["ing-de-outra-empresa"], account_id: "acct-999" }));

    const accountFilters = adminCalls.filter(
      (c) => c.op === "eq" && c.args[0] === "account_id",
    );
    expect(accountFilters.length).toBeGreaterThan(0);
    for (const f of accountFilters) {
      expect(f.args[1]).toBe("acct-1");
    }
  });

  it("sem ids e sem falhas no filtro, não escreve nada", async () => {
    failedIds = [];

    const res = await POST(post({ all_failed: true, days: 30 }));
    expect(await res.json()).toEqual({ requeued: 0 });
    expect(updatesOn(adminCalls, "lead_delivery_jobs")).toHaveLength(0);
  });

  it("'todas as falhas do filtro' seleciona no servidor, pela empresa ativa", async () => {
    failedIds = [{ id: "ing-a" }, { id: "ing-b" }];
    reopenedRows = [
      { id: "job-a", ingestion_id: "ing-a" },
      { id: "job-b", ingestion_id: "ing-b" },
    ];

    const res = await POST(post({ all_failed: true, source: "site", days: 7 }));
    expect(await res.json()).toEqual({ requeued: 2 });

    // A seleção usa o cliente RLS (leitura) e filtra por status.
    const failedFilter = rlsCalls.find(
      (c) => c.op === "eq" && c.args[0] === "overall_status",
    );
    expect(failedFilter?.args[1]).toBe("failed");
  });
});
