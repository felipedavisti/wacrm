import { afterEach, describe, expect, it, vi } from "vitest";

// O roteamento decide DE QUEM é o lead. Um erro aqui não é um bug
// de tela: é o lead de uma empresa aparecendo no funil de outra.
//
// A revisão de segurança de 2026-07-22 achou duas falhas aqui, e
// cada uma tem seu grupo de testes:
//   - a chave vinha do evento e virava PADRÃO de LIKE sem escape;
//   - o token da Meta era lido por id, sem filtro de conta.

import { escapeLikePattern, resolveLeadsToken, resolveSourceByKey } from "./routing";

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

const calls: Call[] = [];
let sourceRow: Record<string, unknown> | null = null;
let appRow: Record<string, unknown> | null = null;

function admin() {
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
  for (const m of ["select", "eq", "ilike", "limit", "not"]) chain[m] = record(m);
  chain.maybeSingle = async () => ({
    data: table === "meta_apps" ? appRow : sourceRow,
    error: null,
  });
  return chain;
}

/** Os filtros aplicados numa tabela, como pares [coluna, valor]. */
function filtersOn(table: string, op: string) {
  return calls
    .filter((c) => c.table === table && c.op === op)
    .map((c) => [c.args[0], c.args[1]] as [unknown, unknown]);
}

afterEach(() => {
  calls.length = 0;
  sourceRow = null;
  appRow = null;
  vi.clearAllMocks();
});

describe("escapeLikePattern", () => {
  it("neutraliza os curingas do LIKE", () => {
    expect(escapeLikePattern("%")).toBe("\\%");
    expect(escapeLikePattern("_")).toBe("\\_");
    expect(escapeLikePattern("Fortaleza_")).toBe("Fortaleza\\_");
    expect(escapeLikePattern("100%_off")).toBe("100\\%\\_off");
  });

  it("escapa a própria barra invertida (senão ela reescapa o resto)", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("não toca em acento, espaço ou caixa — a filial é texto digitado", () => {
    expect(escapeLikePattern("São Luís")).toBe("São Luís");
    expect(escapeLikePattern("Vitalmed - Salvador")).toBe("Vitalmed - Salvador");
  });
});

describe("resolveSourceByKey", () => {
  it("busca a origem com a chave ESCAPADA", async () => {
    sourceRow = { account_id: "acct-1", pipeline_id: null, stage_id: null, meta_app_id: null };

    await resolveSourceByKey(admin(), "filial", "%");

    const ilike = calls.find((c) => c.op === "ilike");
    // Sem escape, "%" casaria com a primeira origem de QUALQUER
    // empresa — injeção de lead entre contas.
    expect(ilike?.args).toEqual(["value", "\\%"]);
  });

  it("preserva a busca case-insensitive (a filial vem digitada num formulário)", async () => {
    sourceRow = { account_id: "acct-1", pipeline_id: null, stage_id: null, meta_app_id: null };

    await resolveSourceByKey(admin(), "filial", "são luís");

    // Continua sendo `ilike` — trocar por `eq` quebraria
    // "SÃO LUÍS" vs "São Luís".
    expect(calls.some((c) => c.op === "ilike")).toBe(true);
    const ilike = calls.find((c) => c.op === "ilike");
    expect(ilike?.args[1]).toBe("são luís");
  });

  it("só considera origem ativa", async () => {
    sourceRow = null;
    await resolveSourceByKey(admin(), "form_id", "123");
    expect(filtersOn("account_lead_sources", "eq")).toContainEqual([
      "active",
      true,
    ]);
  });

  it("sem cadastro devolve null (pendência, nunca descarte)", async () => {
    sourceRow = null;
    expect(await resolveSourceByKey(admin(), "filial", "Recife")).toBeNull();
  });
});

describe("resolveLeadsToken", () => {
  const decrypt = (v: string) => `plain:${v}`;

  it("lê o App da Meta SEMPRE filtrando pela conta", async () => {
    appRow = { leads_access_token: "cipher" };

    const token = await resolveLeadsToken(
      admin(),
      { metaAppId: "app-de-outra-empresa", accountId: "acct-1" },
      decrypt,
    );

    expect(token).toBe("plain:cipher");
    // Sem este filtro, um id de App de outra empresa faria a nossa
    // ingestão rodar com o token da Meta DELA.
    expect(filtersOn("meta_apps", "eq")).toContainEqual([
      "account_id",
      "acct-1",
    ]);
  });

  it("não busca por id quando a conta é desconhecida", async () => {
    appRow = { leads_access_token: "cipher" };

    await resolveLeadsToken(admin(), { metaAppId: "app-1" }, decrypt);

    // Sem conta não há como validar a posse — melhor não resolver
    // do que resolver o App errado.
    expect(filtersOn("meta_apps", "eq")).not.toContainEqual(["id", "app-1"]);
  });

  it("cai para qualquer App da própria conta quando a origem não declara um", async () => {
    appRow = { leads_access_token: "cipher" };

    const token = await resolveLeadsToken(
      admin(),
      { accountId: "acct-1" },
      decrypt,
    );

    expect(token).toBe("plain:cipher");
    expect(filtersOn("meta_apps", "eq")).toContainEqual([
      "account_id",
      "acct-1",
    ]);
  });

  it("token indecifrável não derruba a ingestão — devolve null", async () => {
    appRow = { leads_access_token: "corrompido" };

    const token = await resolveLeadsToken(
      admin(),
      { accountId: "acct-1" },
      () => {
        throw new Error("bad key");
      },
    );

    expect(token).toBeNull();
  });
});
