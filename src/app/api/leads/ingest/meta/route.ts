import { NextResponse } from "next/server";

import { decrypt } from "@/lib/whatsapp/encryption";
import { verifyMetaWebhookSignature } from "@/lib/whatsapp/webhook-signature";
import { loadWebhookAppSecrets } from "@/lib/whatsapp/webhook-auth";

import { supabaseAdmin } from "@/lib/leads/admin-client";
import { ingestLead, recordRejectedEvent } from "@/lib/leads/ingest";
import { normalizeMetaFormLead, type MetaWebhookValue } from "@/lib/leads/normalize";

// /api/leads/ingest/meta (spec 009, US1)
//
// Webhook `leadgen` da Meta. Dois métodos:
//   GET  — handshake de verificação (hub.challenge)
//   POST — recebe os IDs do lead, enriquece na Graph e ingere
//
// Segurança (FR-037): a assinatura HMAC é validada com os MESMOS
// App Secrets do webhook de WhatsApp (`meta_apps` + env fallback,
// spec 007) — é o mesmo App da Meta. Fail-closed: assinatura
// inválida → 401 e registro em `lead_rejected_events`.
//
// Por que responder 200 rápido: a Meta reentrega o evento se
// demorarmos ou falharmos, e reentrega duplicada seria ruído. Como o
// lead é persistido antes de qualquer entrega e a idempotência é
// garantida por `meta_lead_id`, responder 200 é seguro — nada se
// perde, nada duplica.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = searchParams.get("hub.verify_token");

  if (mode !== "subscribe" || !challenge || !verifyToken) {
    return NextResponse.json(
      { error: "Missing verification parameters" },
      { status: 400 },
    );
  }

  // Aceita o verify token de qualquer Meta App cadastrado (mesma
  // lógica do webhook de WhatsApp) ou o do env.
  if (verifyToken === process.env.META_LEADS_VERIFY_TOKEN) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const { data: apps } = await supabaseAdmin()
    .from("meta_apps")
    .select("verify_token");

  for (const app of apps ?? []) {
    if (!app.verify_token) continue;
    try {
      if (decrypt(app.verify_token) === verifyToken) {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
    } catch {
      // Token malformado / chave errada — segue tentando os outros.
    }
  }

  return NextResponse.json(
    { error: "Verification token mismatch" },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  const admin = supabaseAdmin();

  // O corpo cru é necessário para conferir a assinatura — ler como
  // texto e só depois parsear.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  const appSecrets = await loadWebhookAppSecrets(admin);
  if (!verifyMetaWebhookSignature(rawBody, signature, appSecrets)) {
    await recordRejectedEvent(
      admin,
      "meta_form",
      "invalid_signature",
      safeJson(rawBody),
      { "x-hub-signature-256": signature ?? "" },
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = safeJson(rawBody) as
    | { entry?: Array<{ changes?: Array<{ field?: string; value?: unknown }> }> }
    | null;

  if (!body?.entry) {
    await recordRejectedEvent(admin, "meta_form", "invalid_payload", body);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const results: Array<{ leadgen_id?: string; status: string }> = [];

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const value = (change.value ?? {}) as MetaWebhookValue;
      if (!value.leadgen_id) continue;

      try {
        // PERSISTIR PRIMEIRO, enriquecer depois (correção 2026-07-24).
        //
        // O enriquecimento (três chamadas à Graph) morava aqui, antes
        // de qualquer gravação. Como respondemos 200 à Meta — que ela
        // lê como "pode esquecer, é meu" —, uma falha da Graph fazia o
        // lead nunca existir como lead: ia para `lead_rejected_events`,
        // tabela sem tela, sem métrica e sem reprocessamento. A Meta
        // apagava da fila dela e nós não tínhamos onde ver.
        //
        // Agora o lead entra com os ids do webhook e o worker completa,
        // com lease, backoff e reprocessamento pelo painel. De bônus, a
        // rota deixou de gastar três chamadas de rede numa reentrega
        // que ia ser descartada por idempotência no passo seguinte.
        const lead = normalizeMetaFormLead({ webhook: value });
        const res = await ingestLead(admin, lead, { webhook: value });
        results.push({ leadgen_id: value.leadgen_id, status: res.dedup });
      } catch (err) {
        // Enriquecimento/ingestão falhou: registra e segue para os
        // outros leads do lote — um evento problemático não pode
        // derrubar os demais.
        console.error(
          `[leads/ingest/meta] leadgen ${value.leadgen_id} failed:`,
          err,
        );
        await recordRejectedEvent(
          admin,
          "meta_form",
          err instanceof Error ? `ingest_failed: ${err.message}` : "ingest_failed",
          { webhook: value },
        );
        results.push({ leadgen_id: value.leadgen_id, status: "error" });
      }
    }
  }

  // 200 sempre que a assinatura foi válida — ver nota no topo.
  return NextResponse.json({ received: results.length, results });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
