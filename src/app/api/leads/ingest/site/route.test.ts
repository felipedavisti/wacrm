import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/leads/ingest/site — o contrato de borda da ingestão do
// site: fail-closed na autenticação, o evento rejeitado FICA
// registrado, e o payload real de produção vira um lead aceito.

const rejected: Array<Record<string, unknown>> = [];
const ingestCalls: Array<{ lead: unknown; raw: unknown }> = [];
let ingestResult: unknown = {
  ingestionId: "ing-1",
  dedup: "created",
  routing: "resolved",
};
let ingestThrows = false;

vi.mock("@/lib/leads/admin-client", () => ({
  supabaseAdmin: () => ({}),
}));

vi.mock("@/lib/leads/ingest", () => ({
  recordRejectedEvent: async (
    _admin: unknown,
    source: string,
    reason: string,
    payload: unknown,
  ) => {
    rejected.push({ source, reason, payload });
  },
  ingestLead: async (_admin: unknown, lead: unknown, raw: unknown) => {
    ingestCalls.push({ lead, raw });
    if (ingestThrows) throw new Error("boom");
    return ingestResult;
  },
}));

const { POST } = await import("./route");

const SITE_BODY = {
  nome: "Fábio Lennon Moreira Martins ",
  celular: "98984919086",
  telefone: "",
  email: "fabiolennon52@gmail.com",
  cpf: "65861337349",
  data_nascimento: "1981-05-23",
  produto: "Plano APH Tradicional",
  filial: "São Luís",
  sexo: "M",
  estado_civil: "Casado",
};

function post(body: unknown, token?: string): Request {
  return new Request("http://test/api/leads/ingest/site", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-site-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.LEADS_SITE_TOKEN = "s3cret-token";
  ingestThrows = false;
});

afterEach(() => {
  rejected.length = 0;
  ingestCalls.length = 0;
  vi.clearAllMocks();
});

describe("POST /api/leads/ingest/site", () => {
  it("503 when the token is not configured (fail-closed)", async () => {
    delete process.env.LEADS_SITE_TOKEN;
    const res = await POST(post(SITE_BODY, "whatever"));
    expect(res.status).toBe(503);
    expect(ingestCalls).toEqual([]);
  });

  it("401 on a bad token AND records the rejected event", async () => {
    const res = await POST(post(SITE_BODY, "wrong"));
    expect(res.status).toBe(401);
    // Nunca vira lead...
    expect(ingestCalls).toEqual([]);
    // ...mas a tentativa fica registrada (FR-037).
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      source: "site",
      reason: "invalid_token",
    });
    expect(rejected[0].payload).toMatchObject({ cpf: "65861337349" });
  });

  it("401 when the token header is absent entirely", async () => {
    const res = await POST(post(SITE_BODY));
    expect(res.status).toBe(401);
    expect(rejected).toHaveLength(1);
  });

  it("accepts the production payload and returns 202", async () => {
    const res = await POST(post(SITE_BODY, "s3cret-token"));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      ingestion_id: "ing-1",
      dedup: "created",
      routing: "resolved",
    });

    // Normalizou antes de ingerir, e guardou o payload cru original.
    expect(ingestCalls).toHaveLength(1);
    const { lead, raw } = ingestCalls[0] as {
      lead: Record<string, unknown>;
      raw: unknown;
    };
    expect(lead).toMatchObject({
      source: "site",
      product: "APH TRADICIONAL",
      routingKey: { kind: "filial", value: "São Luís" },
    });
    expect(raw).toMatchObject({ celular: "98984919086" });
  });

  it("reports a suppressed duplicate without failing the caller", async () => {
    ingestResult = {
      ingestionId: "ing-original",
      dedup: "suppressed",
      routing: "resolved",
    };
    const res = await POST(post(SITE_BODY, "s3cret-token"));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ dedup: "suppressed" });
    ingestResult = {
      ingestionId: "ing-1",
      dedup: "created",
      routing: "resolved",
    };
  });

  it("still accepts a lead that has no routing rule yet", async () => {
    ingestResult = {
      ingestionId: "ing-2",
      dedup: "created",
      routing: "pending",
    };
    const res = await POST(post({ ...SITE_BODY, filial: "Nova" }, "s3cret-token"));
    // Nunca perder: entra como pendência de roteamento, não erro.
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ routing: "pending" });
    ingestResult = {
      ingestionId: "ing-1",
      dedup: "created",
      routing: "resolved",
    };
  });

  it("tolerates the legacy n8n envelope during the cutover", async () => {
    const res = await POST(
      post([{ headers: {}, body: SITE_BODY }], "s3cret-token"),
    );
    expect(res.status).toBe(202);
    const { lead } = ingestCalls[0] as { lead: Record<string, unknown> };
    expect(lead).toMatchObject({ product: "APH TRADICIONAL" });
  });

  it("400 on a payload that carries no lead body", async () => {
    const res = await POST(post("nope", "s3cret-token"));
    expect(res.status).toBe(400);
    expect(rejected[0]).toMatchObject({ reason: "invalid_payload" });
  });

  it("500 when persistence fails, so the site can retry", async () => {
    ingestThrows = true;
    const res = await POST(post(SITE_BODY, "s3cret-token"));
    expect(res.status).toBe(500);
  });
});
