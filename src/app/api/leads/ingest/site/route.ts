import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/leads/admin-client";
import { ingestLead, recordRejectedEvent } from "@/lib/leads/ingest";
import { normalizeSiteLead } from "@/lib/leads/normalize";

// POST /api/leads/ingest/site (spec 009, US2)
//
// Ponto de entrada do formulário/simulação do site. O site posta
// DIRETO aqui — o webhook intermediário do n8n foi eliminado.
//
// Fail-closed (FR-037): sem token válido o evento é rejeitado e
// registrado em `lead_rejected_events` — nunca vira lead, e nunca
// some silenciosamente (queremos ver tentativa inválida).
//
// A resposta é 202: aceitamos e persistimos o lead; a ENTREGA
// (virar negócio no funil) é assíncrona, pelo worker do outbox.
// Assim uma indisponibilidade do destino nunca devolve erro para o
// site nem perde o lead.

/** Compara em tempo constante, tolerando tamanhos diferentes. */
function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * O corpo do lead. O site posta os campos direto; toleramos também
 * o envelope do n8n (`[{ body: {...} }]`) para que um repontamento
 * do fluxo antigo não caia num 400 confuso durante a transição.
 */
function extractBody(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) {
    const first = payload[0] as Record<string, unknown> | undefined;
    const inner = first?.body;
    if (inner && typeof inner === "object") {
      return inner as Record<string, unknown>;
    }
    return null;
  }
  if (payload && typeof payload === "object") {
    const maybe = payload as Record<string, unknown>;
    if (maybe.body && typeof maybe.body === "object") {
      return maybe.body as Record<string, unknown>;
    }
    return maybe;
  }
  return null;
}

export async function POST(request: Request) {
  const expected = process.env.LEADS_SITE_TOKEN;
  const admin = supabaseAdmin();

  // Lido uma vez: o corpo é preservado mesmo numa rejeição, porque
  // saber O QUE tentaram mandar é o valor do registro.
  const payload = await request.json().catch(() => null);

  if (!expected) {
    console.error("[leads/ingest/site] LEADS_SITE_TOKEN is not configured");
    return NextResponse.json(
      { error: "Lead ingestion is not configured" },
      { status: 503 },
    );
  }

  const supplied = request.headers.get("x-site-token") ?? "";
  if (!secretMatches(supplied, expected)) {
    await recordRejectedEvent(admin, "site", "invalid_token", payload, {
      "user-agent": request.headers.get("user-agent") ?? "",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = extractBody(payload);
  if (!body) {
    await recordRejectedEvent(admin, "site", "invalid_payload", payload);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const lead = normalizeSiteLead(body);
    const result = await ingestLead(admin, lead, payload);

    return NextResponse.json(
      {
        ingestion_id: result.ingestionId,
        dedup: result.dedup,
        routing: result.routing,
      },
      { status: 202 },
    );
  } catch (err) {
    // Chegou aqui = o lead NÃO foi persistido (falha antes/durante o
    // insert). Devolvemos 500 de propósito: o site pode reenviar, e
    // a dedup impede que o reenvio duplique.
    console.error("[leads/ingest/site] ingestion failed:", err);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}
