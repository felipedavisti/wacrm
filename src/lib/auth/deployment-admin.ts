// ============================================================
// Gate da superfície CENTRAL (spec 009, decisão B1=A).
//
// Quase tudo no CRM é escopado pela empresa ativa. A fila de leads
// não-roteados não pode ser: um lead sem empresa não pertence a
// ninguém, então nenhuma policy de RLS o enxerga. Alguém precisa
// olhar por cima das empresas para dizer "este formulário é da
// Salvador".
//
// Quem é esse alguém: **owner de qualquer empresa do deployment**.
// No modelo um-deploy-por-cliente, é a TI/dono da operação. Não
// existe conceito de super-admin no produto, e inventar um só para
// isto seria pior.
//
// Regra que fecha o buraco óbvio: um owner só pode direcionar leads
// para empresas que ELE possui. Sem isso, o owner da empresa A
// poderia despejar leads na empresa B.
//
// Server-only (importa o cliente SSR), como ./account.
// ============================================================

import { createClient } from "@/lib/supabase/server";

import { ForbiddenError, UnauthorizedError } from "./account";

export interface DeploymentAdminContext {
  userId: string;
  /** Contas em que o chamador é owner — o que ele pode manipular. */
  ownedAccountIds: string[];
}

/**
 * Exige que o chamador seja owner de pelo menos uma empresa.
 * Lança `UnauthorizedError` (sem sessão) ou `ForbiddenError`.
 */
export async function requireDeploymentAdmin(): Promise<DeploymentAdminContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) throw new UnauthorizedError();

  // RLS de `account_members` já permite ler os próprios vínculos.
  const { data, error } = await supabase
    .from("account_members")
    .select("account_id")
    .eq("user_id", user.id)
    .eq("role", "owner");

  if (error) {
    console.error("[requireDeploymentAdmin] membership fetch error:", error);
    throw new ForbiddenError("Could not verify ownership");
  }

  const ownedAccountIds = (data ?? []).map(
    (r: { account_id: string }) => r.account_id,
  );

  if (ownedAccountIds.length === 0) {
    throw new ForbiddenError(
      "This area is restricted to company owners",
    );
  }

  return { userId: user.id, ownedAccountIds };
}
