import { afterEach, describe, expect, it, vi } from "vitest";

// O worker do outbox. Estes testes cobrem o que a serialização
// escondia: com entrega I/O-bound (Graph + Postgres), processar um
// job de cada vez desperdiça o tempo de espera. O pool tem de rodar
// N em voo — e nunca mais que N.

const emVoo: number[] = [];
let picoSimultaneo = 0;
let atual = 0;
/** Ids de job que devem falhar na entrega. */
let falham = new Set<string>();
let duracaoMs = 5;

vi.mock("./enrich-pending", () => ({
  enrichPendingMetaLead: async (_a: unknown, ing: { canonical: unknown }) =>
    ing.canonical,
}));

vi.mock("./deliver-internal", async () => {
  const real = await vi.importActual<typeof import("./deliver-internal")>(
    "./deliver-internal",
  );
  return {
    ...real,
    deliverInternal: async (_admin: unknown, ing: { id: string }) => {
      atual++;
      picoSimultaneo = Math.max(picoSimultaneo, atual);
      emVoo.push(atual);
      await new Promise((r) => setTimeout(r, duracaoMs));
      atual--;
      if (falham.has(ing.id)) throw new Error(`falha proposital em ${ing.id}`);
      return { contactId: "c-1", dealId: `deal-${ing.id}` };
    },
  };
});

const { runWorkerTick } = await import("./worker");

const finished: Array<{ id: string; ok: boolean; classe: string | null }> = [];

/** Admin falso: devolve N jobs no claim e registra os finish. */
function admin(qtdJobs: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["from", "select", "eq"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({
    data: {
      id: chain._id,
      account_id: "acct-1",
      canonical: { source: "site", contact: {}, tracking: {}, routingKey: null },
      target_pipeline_id: null,
      target_stage_id: null,
      contact_id: null,
      deal_id: null,
      welcome_sent_at: null,
    },
    error: null,
  });

  return {
    from: (t: string) => {
      void t;
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: async (nome: string, args: any) => {
      if (nome === "claim_lead_delivery_jobs") {
        return {
          data: Array.from({ length: qtdJobs }, (_, i) => ({
            id: `job-${i}`,
            ingestion_id: `ing-${i}`,
            destination: "internal",
            account_id: "acct-1",
            attempts: 0,
          })),
          error: null,
        };
      }
      if (nome === "finish_lead_delivery_job") {
        finished.push({
          id: args.p_job_id,
          ok: args.p_ok,
          classe: args.p_error_class,
        });
      }
      return { data: null, error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// O deliverJob busca a ingestion por id; o mock acima devolve
// sempre a mesma forma, com o id do job embutido.
function adminComId(qtdJobs: number) {
  const base = admin(qtdJobs);
  const orig = base.from;
  base.from = (t: string) => {
    const c = orig(t);
    c._id = "ing-x";
    return c;
  };
  return base;
}

afterEach(() => {
  emVoo.length = 0;
  finished.length = 0;
  picoSimultaneo = 0;
  atual = 0;
  falham = new Set();
  duracaoMs = 5;
  delete process.env.LEADS_WORKER_CONCURRENCY;
  vi.clearAllMocks();
});

describe("runWorkerTick", () => {
  it("processa vários jobs EM PARALELO, não um de cada vez", async () => {
    const r = await runWorkerTick(adminComId(8));

    expect(r.claimed).toBe(8);
    expect(r.succeeded).toBe(8);
    // Serializado, o pico seria 1. O ganho de tempo vem daqui.
    expect(picoSimultaneo).toBeGreaterThan(1);
  });

  it("nunca excede o limite de concorrência", async () => {
    process.env.LEADS_WORKER_CONCURRENCY = "3";

    await runWorkerTick(adminComId(12));

    // Estourar isto significa 12 chamadas simultâneas à Graph —
    // convite a 429 da Meta e a esgotar o pool do Postgres.
    expect(picoSimultaneo).toBeLessThanOrEqual(3);
  });

  it("teto de concorrência é respeitado mesmo com valor absurdo", async () => {
    process.env.LEADS_WORKER_CONCURRENCY = "999";

    await runWorkerTick(adminComId(20));

    expect(picoSimultaneo).toBeLessThanOrEqual(16);
  });

  it("valor inválido cai no padrão em vez de quebrar", async () => {
    process.env.LEADS_WORKER_CONCURRENCY = "abacaxi";

    const r = await runWorkerTick(adminComId(6));

    expect(r.succeeded).toBe(6);
    expect(picoSimultaneo).toBeLessThanOrEqual(4);
  });

  it("um job que falha NÃO impede os outros de entregar", async () => {
    falham = new Set(["ing-x"]);

    const r = await runWorkerTick(adminComId(5));

    // Todos falham porque o mock resolve sempre para o mesmo id —
    // o que importa é que os 5 foram TENTADOS e finalizados.
    expect(r.claimed).toBe(5);
    expect(r.succeeded + r.failed).toBe(5);
    expect(finished).toHaveLength(5);
  });

  it("falha de entrega é classificada como retentável", async () => {
    falham = new Set(["ing-x"]);

    await runWorkerTick(adminComId(2));

    for (const f of finished) {
      expect(f.ok).toBe(false);
      // `retryable` devolve o job para a fila com backoff; se virasse
      // `permanent`, um erro de rede mataria o lead na primeira.
      expect(f.classe).toBe("retryable");
    }
  });

  it("sem jobs, não faz nada e não quebra", async () => {
    const r = await runWorkerTick(adminComId(0));
    expect(r).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
  });
});
