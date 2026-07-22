import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A saudação automática é a única parte do motor que FALA COM UM
// CLIENTE REAL. Todo teste aqui protege uma das três garantias:
//
//   1. não envia por padrão (senão homologar dispara mensagem);
//   2. não reenvia (reprocessar não pode mandar "olá" de novo);
//   3. não derruba a entrega (o negócio já está no funil).
//
// O quarto grupo protege contra o achado da revisão de segurança:
// um curinga na chave de origem mandaria mensagem do número de
// OUTRA empresa para um telefone escolhido por quem postou o evento.

import type { CanonicalLead } from "./canonical";

const sends: Array<Record<string, unknown>> = [];
const resolves: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];
const sourceQueries: Array<{ op: string; args: unknown[] }> = [];

/** O que a busca por `account_lead_sources` devolve. */
let sourceRow: Record<string, unknown> | null = null;
let sendThrows: Error | null = null;

vi.mock("@/lib/whatsapp/resolve-conversation", () => ({
  resolveConversationByPhone: async (
    _db: unknown,
    accountId: string,
    phone: string,
    name: string | null,
  ) => {
    resolves.push({ accountId, phone, name });
    return { conversationId: "conv-1", contactId: "c-1", contactCreated: false };
  },
}));

vi.mock("@/lib/whatsapp/send-message", () => ({
  sendMessageToConversation: async (
    _db: unknown,
    accountId: string,
    params: Record<string, unknown>,
  ) => {
    sends.push({ accountId, ...params });
    if (sendThrows) throw sendThrows;
    return { messageId: "m-1", whatsappMessageId: "wamid.1" };
  },
}));

function admin() {
  let table = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const passthrough =
    (op: string) =>
    (...args: unknown[]) => {
      if (table === "account_lead_sources") sourceQueries.push({ op, args });
      return chain;
    };
  chain.from = (t: string) => {
    table = t;
    return chain;
  };
  for (const m of ["select", "eq", "ilike", "limit"]) chain[m] = passthrough(m);
  chain.update = (payload: Record<string, unknown>) => {
    updates.push(payload);
    return chain;
  };
  chain.maybeSingle = async () => ({ data: sourceRow, error: null });
  chain.then = (
    res: (v: unknown) => unknown,
    rej: (e: unknown) => unknown,
  ) => Promise.resolve({ data: null, error: null }).then(res, rej);
  return chain;
}

const { maybeSendLeadWelcome } = await import("./welcome");

function lead(over: Partial<CanonicalLead> = {}): CanonicalLead {
  return {
    source: "site",
    contact: { name: "Fulano", phone: "5571988887777" },
    tracking: {},
    routingKey: { kind: "filial", value: "São Luís" },
    ...over,
  };
}

const ENABLED = {
  welcome_enabled: true,
  welcome_template_name: "hello_world",
  welcome_template_language: "en_US",
};

beforeEach(() => {
  sourceRow = { ...ENABLED };
  sendThrows = null;
});

afterEach(() => {
  sends.length = 0;
  resolves.length = 0;
  updates.length = 0;
  sourceQueries.length = 0;
  vi.clearAllMocks();
});

describe("maybeSendLeadWelcome", () => {
  it("NÃO envia quando a origem está desligada (o padrão)", async () => {
    sourceRow = { welcome_enabled: false, welcome_template_name: null };

    await maybeSendLeadWelcome(admin(), {
      ingestionId: "ing-1",
      accountId: "acct-1",
      lead: lead(),
      welcomeSentAt: null,
    });

    expect(sends).toHaveLength(0);
    expect(resolves).toHaveLength(0);
  });

  it("NÃO envia quando a origem não tem template, mesmo marcada como ligada", async () => {
    sourceRow = { welcome_enabled: true, welcome_template_name: null };

    await maybeSendLeadWelcome(admin(), {
      ingestionId: "ing-1",
      accountId: "acct-1",
      lead: lead(),
      welcomeSentAt: null,
    });

    expect(sends).toHaveLength(0);
  });

  it("NÃO reenvia para um lead que já foi saudado", async () => {
    await maybeSendLeadWelcome(admin(), {
      ingestionId: "ing-1",
      accountId: "acct-1",
      lead: lead(),
      welcomeSentAt: "2026-07-22T10:00:00Z",
    });

    // Nem chega a consultar a origem — sai antes de tocar o banco.
    expect(sourceQueries).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });

  it("NÃO envia para lead de CTWA (o cliente já escreveu)", async () => {
    await maybeSendLeadWelcome(admin(), {
      ingestionId: "ing-1",
      accountId: "acct-1",
      lead: lead({ source: "meta_ctwa", routingKey: null }),
      welcomeSentAt: null,
    });

    expect(sourceQueries).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });

  it("NÃO envia quando o lead veio sem telefone", async () => {
    await maybeSendLeadWelcome(admin(), {
      ingestionId: "ing-1",
      accountId: "acct-1",
      lead: lead({ contact: { name: "Sem Telefone" } }),
      welcomeSentAt: null,
    });

    expect(sends).toHaveLength(0);
  });

  it("envia o template configurado e marca o lead como saudado", async () => {
    await maybeSendLeadWelcome(admin(), {
      ingestionId: "ing-1",
      accountId: "acct-1",
      lead: lead(),
      welcomeSentAt: null,
    });

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      accountId: "acct-1",
      conversationId: "conv-1",
      messageType: "template",
      templateName: "hello_world",
      templateLanguage: "en_US",
      senderId: null,
    });
    expect(updates[0]).toHaveProperty("welcome_sent_at");
    expect(updates[0]).toMatchObject({ welcome_error: null });
  });

  it("escapa curingas na chave de origem (não pode casar com outra empresa)", async () => {
    await maybeSendLeadWelcome(admin(), {
      ingestionId: "ing-1",
      accountId: "acct-1",
      lead: lead({ routingKey: { kind: "filial", value: "%" } }),
      welcomeSentAt: null,
    });

    const ilike = sourceQueries.find((q) => q.op === "ilike");
    // Sem o escape, "%" casaria com a PRIMEIRA origem de qualquer
    // empresa e mandaria uma mensagem real do número dela.
    expect(ilike?.args[1]).toBe("\\%");
  });

  it("falha no envio NÃO derruba a entrega: registra o erro e deixa reprocessável", async () => {
    sendThrows = new Error("(#132001) Template name does not exist");

    await expect(
      maybeSendLeadWelcome(admin(), {
        ingestionId: "ing-1",
        accountId: "acct-1",
        lead: lead(),
        welcomeSentAt: null,
      }),
    ).resolves.toBeUndefined();

    // O erro fica NO LEAD, e `welcome_sent_at` continua nulo — assim
    // reprocessar tenta de novo depois do template corrigido.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("welcome_error");
    expect(updates[0]).not.toHaveProperty("welcome_sent_at");
  });
});
