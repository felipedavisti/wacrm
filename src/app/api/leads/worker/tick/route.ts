import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/leads/admin-client";
import { runWorkerTick } from "@/lib/leads/worker";

// POST /api/leads/worker/tick (spec 009, FR-016)
//
// Drena o outbox de entrega. Feito para ser chamado por um
// agendador externo (Vercel Cron / pinger) a cada ~1 minuto —
// escolha deliberada em vez de pg_cron: a entrega roda em Node,
// então erro tem stack e log de aplicação, e não dependemos de
// extensão nem de o projeto Supabase estar "acordado".
//
// Auth: segredo compartilhado `x-cron-secret`, comparado em tempo
// constante — mesmo padrão do cron de automações. Fail-closed: sem
// segredo configurado, o endpoint não roda (503).
//
// Aceita GET **e** POST pelo mesmo handler. POST é o verbo correto
// (a chamada tem efeito colateral), mas os dois crons que já existem
// aqui — /api/automations/cron e /api/flows/cron — são GET, e muito
// agendador gratuito só dispara GET. Quem for configurar os três
// numa tarde não deveria descobrir que o terceiro é diferente. O
// endpoint é protegido por segredo, então o risco real de um GET
// com efeito (pré-busca de navegador, crawler) não se aplica.
export async function GET(request: Request) {
  return handleTick(request);
}

export async function POST(request: Request) {
  return handleTick(request);
}

async function handleTick(request: Request) {
  const expected = process.env.LEADS_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }

  const supplied = request.headers.get("x-cron-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runWorkerTick(supabaseAdmin());
    return NextResponse.json(result);
  } catch (err) {
    console.error("[leads/worker/tick] unexpected error:", err);
    return NextResponse.json({ error: "Worker tick failed" }, { status: 500 });
  }
}
