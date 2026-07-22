// ============================================================
// Gate da superfície CENTRAL (spec 009, decisão B1=A).
//
// Quase tudo no CRM é escopado pela empresa ativa. A fila de leads
// não-roteados não pode ser: um lead sem empresa não pertence a
// ninguém, então nenhuma policy de RLS o enxerga. Alguém precisa
// olhar por cima das empresas para dizer "este formulário é da
// Salvador".
//
// Quem é esse alguém:
//
//   1. os usuários listados em `LEADS_DEPLOYMENT_ADMINS`, se a
//      variável existir; ou
//   2. na ausência dela, **owner de qualquer empresa** — o padrão do
//      modelo um-deploy-por-cliente, onde a TI/dono da operação é a
//      única pessoa com esse papel.
//
// POR QUE A VARIÁVEL EXISTE (revisão de segurança de 2026-07-22):
// o padrão (2) só é seguro enquanto o deployment atende UM cliente.
// Com duas empresas de donos diferentes no mesmo deploy, o owner da
// empresa A vê as chaves de origem não cadastradas da empresa B e
// pode reivindicá-las para si — levando os leads de B (nome,
// telefone, e-mail, CPF) para o funil de A, e de forma permanente,
// porque o cadastro é "quem chegar primeiro". Antes de colocar um
// segundo cliente no mesmo deploy, DEFINA a variável.
//
// Regra que continua valendo em qualquer um dos modos: um admin só
// pode direcionar leads para empresas que ELE possui.
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

  // Allowlist explícita, quando configurada. Fail-closed: quem não
  // está na lista não entra, nem sendo owner.
  const allowlist = (process.env.LEADS_DEPLOYMENT_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowlist.length > 0 && !allowlist.includes(user.id)) {
    throw new ForbiddenError(
      "This area is restricted to the deployment operator",
    );
  }

  return { userId: user.id, ownedAccountIds };
}
