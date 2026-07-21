// ============================================================
// Cliente service_role do Motor de Leads.
//
// Por que o motor precisa ignorar RLS: a ingestão acontece ANTES de
// existir um usuário logado (webhook da Meta, POST do site) e antes
// de o lead ter empresa (pendência de roteamento). Não há
// `auth.uid()` para o RLS avaliar.
//
// Contrato de segurança (Constituição II — este arquivo entra no
// `docs/service-role-inventory.md`):
//   - toda escrita de domínio DEVE carimbar o `account_id` resolvido
//     pelo roteamento (usar `requireAccountScope` no ponto de
//     entrega);
//   - nada aqui é exposto ao cliente: as rotas do painel usam o
//     cliente RLS do usuário, nunca este.
// ============================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[leads] SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are required",
    );
  }

  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}
