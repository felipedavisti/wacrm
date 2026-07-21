import { describe, expect, it } from "vitest";

import { normalizeMetaFormLead, normalizeSiteLead } from "./normalize";
import { buildDedupKey, dedupWindowStart } from "./dedup";
import { normalizeBrazilPhone, normalizeProduct } from "./canonical";

// Fixtures são os payloads REAIS de produção (spec 009): o corpo do
// formulário do site e o webhook `leadgen` da Meta + o resultado das
// chamadas Graph que o fluxo n8n `RECEBE LEADS` fazia.

describe("normalizeSiteLead", () => {
  const SITE_BODY = {
    nome: "Fábio Lennon Moreira Martins ",
    celular: "98984919086",
    telefone: "",
    email: "FabioLennon52@gmail.com",
    cpf: "658.613.373-49",
    data_nascimento: "1981-05-23",
    produto: "Plano APH Tradicional",
    filial: "São Luís",
    sexo: "M",
    estado_civil: "Casado",
  };

  it("maps the production site payload to the canonical shape", () => {
    const lead = normalizeSiteLead(SITE_BODY);

    expect(lead.source).toBe("site");
    expect(lead.contact).toMatchObject({
      name: "Fábio Lennon Moreira Martins",
      // DDD + 9 dígitos ganha o DDI 55.
      phone: "5598984919086",
      email: "fabiolennon52@gmail.com",
      cpf: "65861337349",
      birth_date: "1981-05-23",
    });
    // Prefixo "Plano " sai para a dedup casar entre envios.
    expect(lead.product).toBe("APH TRADICIONAL");
  });

  it("routes by filial — the site states the company explicitly", () => {
    const lead = normalizeSiteLead(SITE_BODY);
    expect(lead.routingKey).toEqual({ kind: "filial", value: "São Luís" });
  });

  it("falls back to telefone when celular is empty", () => {
    const lead = normalizeSiteLead({
      ...SITE_BODY,
      celular: "",
      telefone: "7133334444",
    });
    expect(lead.contact.phone).toBe("557133334444");
  });

  it("flags missing expected fields instead of rejecting the lead", () => {
    const lead = normalizeSiteLead({ nome: "Só o nome" });
    // Nunca descartar: o lead existe, a ausência é sinalizada.
    expect(lead.contact.name).toBe("Só o nome");
    expect(lead.missingFields).toEqual(["celular", "email", "produto", "filial"]);
    expect(lead.routingKey).toBeNull();
  });
});

describe("normalizeMetaFormLead", () => {
  const WEBHOOK = {
    adgroup_id: "120249037631560167",
    ad_id: "120249037631560167",
    created_time: 1784575463,
    leadgen_id: "3010017592539830",
    page_id: "574208809699562",
    form_id: "1091282319809800",
  };

  const LEADGEN = {
    id: "3010017592539830",
    field_data: [
      { name: "nome_completo", values: ["Maria Silva"] },
      { name: "telefone", values: ["+55 71 98299-7805"] },
      { name: "email", values: ["Maria@example.com"] },
      {
        name: "o_que_fez_você_buscar_mais_segurança_em_saúde_neste_momento?",
        values: ["Tenho filhos pequenos"],
      },
    ],
    campaign_name: "[2026.07]|[APH SSA]|[LEADS]",
    campaign_id: "camp-1",
    adset_name: "Conjunto A",
    adset_id: "adset-1",
    ad_id: "ad-1",
    ad_name: "Criativo Vídeo 1",
    form_id: "1091282319809800",
    platform: "fb",
  };

  it("fills all 7 tracking fields from the enriched Graph payload", () => {
    const lead = normalizeMetaFormLead({
      webhook: WEBHOOK,
      leadgen: LEADGEN,
      adInfo: { id: "ad-1", name: "Criativo Vídeo 1", account_id: "act-9" },
      formName: "Formulário FSA",
    });

    expect(lead.tracking).toMatchObject({
      campaign_name: "[2026.07]|[APH SSA]|[LEADS]", // → utm.campaign
      adset_name: "Conjunto A", // → ink_new_utmcampanha
      adset_id: "adset-1", // → ink_new_Id_Campanha
      leadgen_id: "3010017592539830", // → ink_new_ID_Lead
      form_id: "1091282319809800", // → ink_new_ID_Formulario
      ad_id: "ad-1", // → ink_new_Id_Criativo
      ad_name: "Criativo Vídeo 1", // → ink_new_Criativo_Facebook
    });
    expect(lead.medium).toBe("Tráfego Pago");
  });

  it("normalizes contact fields out of field_data", () => {
    const lead = normalizeMetaFormLead({ webhook: WEBHOOK, leadgen: LEADGEN });
    expect(lead.contact).toMatchObject({
      name: "Maria Silva",
      phone: "5571982997805",
      email: "maria@example.com",
    });
  });

  it("keeps unknown form questions instead of dropping them", () => {
    // The form's question wording changes between versions — the
    // whole point of not hard-coding them (see 011 format alerts).
    const lead = normalizeMetaFormLead({ webhook: WEBHOOK, leadgen: LEADGEN });
    expect(lead.answers).toEqual([
      {
        question: "o que fez você buscar mais segurança em saúde neste momento?",
        answer: "Tenho filhos pequenos",
      },
    ]);
  });

  it("routes by form_id (each form belongs to one company)", () => {
    const lead = normalizeMetaFormLead({ webhook: WEBHOOK, leadgen: LEADGEN });
    expect(lead.routingKey).toEqual({
      kind: "form_id",
      value: "1091282319809800",
    });
  });

  it("still produces a lead when the Graph enrichment is missing", () => {
    // Graph unreachable: we keep the ids the webhook gave us and
    // flag what's missing — the delivery retries later.
    const lead = normalizeMetaFormLead({ webhook: WEBHOOK });
    expect(lead.tracking.leadgen_id).toBe("3010017592539830");
    expect(lead.tracking.form_id).toBe("1091282319809800");
    expect(lead.missingFields).toEqual(["nome_completo", "telefone", "email"]);
    expect(lead.routingKey).not.toBeNull();
  });
});

describe("dedup keys", () => {
  const site = (over: Record<string, unknown> = {}) =>
    normalizeSiteLead({
      nome: "A",
      celular: "71999998888",
      email: "a@x.com",
      cpf: "65861337349",
      produto: "Plano APH Tradicional",
      filial: "Salvador",
      ...over,
    });

  it("site: same person + same product collide", () => {
    expect(buildDedupKey(site())).toBe(buildDedupKey(site()));
  });

  it("site: cpf is the identity — contact details may drift", () => {
    // Same CPF and product, different phone/email → still the same
    // person asking for the same plan.
    const a = buildDedupKey(site());
    const b = buildDedupKey(site({ celular: "71911112222", email: "b@x.com" }));
    expect(a).toBe(b);
  });

  it("site: a different product is a different lead", () => {
    expect(buildDedupKey(site())).not.toBe(
      buildDedupKey(site({ produto: "Plano Premium" })),
    );
  });

  it("site: dedup uses a 24h window", () => {
    const now = new Date("2026-07-21T12:00:00Z");
    const start = dedupWindowStart(site(), now);
    expect(start?.toISOString()).toBe("2026-07-20T12:00:00.000Z");
  });

  it("site: no identity at all → no dedup (never lose the lead)", () => {
    expect(buildDedupKey(site({ cpf: "", celular: "", email: "" }))).toBeNull();
  });

  const meta = (formId: string, phone: string) =>
    normalizeMetaFormLead({
      webhook: { form_id: formId, leadgen_id: "L1" },
      leadgen: {
        form_id: formId,
        field_data: [{ name: "telefone", values: [phone] }],
      },
    });

  it("meta: same contact in the same form collides", () => {
    expect(buildDedupKey(meta("F1", "71999998888"))).toBe(
      buildDedupKey(meta("F1", "71999998888")),
    );
  });

  it("meta: same contact in a DIFFERENT form is a distinct lead", () => {
    expect(buildDedupKey(meta("F1", "71999998888"))).not.toBe(
      buildDedupKey(meta("F2", "71999998888")),
    );
  });

  it("meta: no window — any earlier lead counts as duplicate", () => {
    expect(dedupWindowStart(meta("F1", "71999998888"))).toBeNull();
  });
});

describe("phone/product helpers", () => {
  it("adds the 55 DDI only for 10/11-digit national numbers", () => {
    expect(normalizeBrazilPhone("98984919086")).toBe("5598984919086"); // 11
    expect(normalizeBrazilPhone("7133334444")).toBe("557133334444"); // 10
    expect(normalizeBrazilPhone("5571982997805")).toBe("5571982997805"); // 13
    expect(normalizeBrazilPhone("+55 71 98299-7805")).toBe("5571982997805");
  });

  it("leaves foreign/odd lengths alone rather than forging a DDI", () => {
    expect(normalizeBrazilPhone("37063949836")).toBe("5537063949836"); // 11 → BR
    expect(normalizeBrazilPhone("123")).toBe("123");
  });

  it("strips the 'Plano ' prefix for dedup matching", () => {
    expect(normalizeProduct("Plano APH Tradicional")).toBe("APH TRADICIONAL");
    expect(normalizeProduct("  plano   Premium ")).toBe("PREMIUM");
    expect(normalizeProduct("")).toBeUndefined();
  });
});
