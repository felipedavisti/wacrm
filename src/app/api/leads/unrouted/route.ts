// ============================================================
// GET /api/leads/unrouted — a fila do "nunca perder" (spec 009, US4)
//
// Leads que chegaram mas não têm empresa: a origem (formulário ou
// filial) não está cadastrada em conta nenhuma. Eles não aparecem em
// painel de empresa alguma — por definição, `account_id IS NULL` não
// casa com nenhuma policy de RLS. Sem esta tela, seriam invisíveis.
//
// Vem AGRUPADO por chave de origem, não como lista solta: o que o
// operador precisa decidir não é "para onde vai este lead", e sim
// "de quem é este formulário" — uma decisão que resolve todos os
// leads parados daquela origem de uma vez.
//
// Acesso: owner de qualquer empresa (superfície central).
// Leitura via service_role porque o RLS, corretamente, esconde
// linhas sem dono.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireDeploymentAdmin } from "@/lib/auth/deployment-admin";
import { supabaseAdmin } from "@/lib/leads/admin-client";
import type { CanonicalLead } from "@/lib/leads/canonical";

interface PendingRow {
  id: string;
  source: string;
  canonical: CanonicalLead;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await requireDeploymentAdmin();

    const { data, error } = await supabaseAdmin()
      .from("lead_ingestions")
      .select("id, source, canonical, created_at")
      .eq("routing_status", "pending")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("[GET /api/leads/unrouted] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load unrouted leads" },
        { status: 500 },
      );
    }

    // Agrupa por (tipo, valor) da chave de roteamento — é a unidade
    // de decisão. Um formulário novo da agência vira UMA linha aqui,
    // com "23 leads parados", em vez de 23 linhas idênticas.
    const groups = new Map<
      string,
      {
        kind: string;
        value: string;
        source: string;
        count: number;
        first_seen: string;
        last_seen: string;
        sample: { name?: string; phone?: string } | null;
      }
    >();

    let unknown = 0;
    for (const row of (data ?? []) as PendingRow[]) {
      const key = row.canonical?.routingKey;
      if (!key) {
        // Lead sem nenhuma chave (ex.: site sem filial). Não dá para
        // cadastrar origem — precisa de atribuição manual.
        unknown++;
        continue;
      }
      const id = `${key.kind}:${key.value.toLowerCase()}`;
      const existing = groups.get(id);
      if (existing) {
        existing.count++;
        existing.first_seen = row.created_at;
      } else {
        groups.set(id, {
          kind: key.kind,
          value: key.value,
          source: row.source,
          count: 1,
          first_seen: row.created_at,
          last_seen: row.created_at,
          sample: {
            name: row.canonical?.contact?.name,
            phone: row.canonical?.contact?.phone,
          },
        });
      }
    }

    // Empresas para as quais este owner pode direcionar (as dele).
    const { data: owned } = await supabaseAdmin()
      .from("accounts")
      .select("id, name")
      .in("id", ctx.ownedAccountIds)
      .order("name");

    return NextResponse.json({
      groups: [...groups.values()].sort((a, b) => b.count - a.count),
      total: data?.length ?? 0,
      unkeyed: unknown,
      accounts: owned ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
