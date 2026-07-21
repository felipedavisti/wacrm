-- ============================================================
-- 509_is_account_member_multi (spec 008 — multi-conta)
--
-- Reescreve a FRONTEIRA DE SEGURANÇA da tenancy: is_account_member
-- passa a resolver a pertença em `account_members` (N-para-N, 508)
-- em vez de `profiles.account_id` (membership única, 017).
--
-- Mesma assinatura, mesmo rank de papéis, mesmos grants — as ~36
-- policies de RLS que a chamam continuam idênticas. O que muda é
-- apenas COMO a pertença é resolvida: o usuário está autorizado em
-- TODAS as contas em que tem vínculo (e somente nelas). A "conta
-- ativa" (profiles.account_id) é filtro de visão da aplicação, não
-- fronteira — o RLS continua barrando contas não-membro.
--
-- SECURITY DEFINER (owner postgres): a leitura de account_members
-- aqui dentro não reavalia as policies da própria tabela (que chamam
-- esta função) — sem recursão, mesmo padrão da 017.
--
-- DIVERGÊNCIA DELIBERADA do upstream (Princípio V). Superfície
-- sensível (Princípio II): revisar contra vazamento entre contas.
-- ============================================================

CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM account_members m
    WHERE m.user_id = auth.uid()
      AND m.account_id = target_account_id
      AND CASE m.role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum)
  TO authenticated, service_role;
