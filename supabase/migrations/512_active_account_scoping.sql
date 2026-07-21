-- ============================================================
-- 512_active_account_scoping (spec 008 — hotfix de escopo)
--
-- PROBLEMA (encontrado no teste de dev): no mundo 1-conta, o RLS
-- `is_account_member(account_id)` sozinho escopava toda query — o
-- usuário só era membro de UMA conta. Com o multi-conta (509), o
-- RLS autoriza TODAS as empresas do usuário, e as dezenas de queries
-- client-side que não filtram por conta explicitamente passaram a
-- misturar dados das empresas (inbox, funil, contatos, dashboard).
--
-- CORREÇÃO (ponto único): nas TABELAS DE DOMÍNIO, o RLS passa a
-- exigir "membro E conta ATIVA" — `is_active_member`. A visão por
-- empresa ativa (FR-016/FR-017) vira garantia de BANCO: nenhuma
-- query (nem realtime) enxerga outra empresa sem trocar de conta.
--
-- Ficam com semântica de PERTENÇA PURA (não-ativa) apenas:
--   accounts, account_members, profiles, account_invitations —
--   o seletor precisa listar todas as empresas do usuário, e o
--   roster precisa dos profiles de quem compartilha empresa.
--
-- service_role e as RPCs SECURITY DEFINER seguem fora do RLS
-- (webhook/engines/admin intactos). Trocar de conta continua sendo
-- exclusivamente a RPC set_active_account (510).
--
-- DIVERGÊNCIA DELIBERADA do upstream (Princípio V); superfície
-- sensível (Princípio II) — o helper novo é a fronteira de visão.
-- ============================================================

-- Membro da conta E com ela como conta ATIVA. O min_role preserva a
-- semântica de papel das policies que exigem admin+ (a troca textual
-- abaixo mantém os argumentos originais).
CREATE OR REPLACE FUNCTION is_active_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    target_account_id IS NOT DISTINCT FROM (
      SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid()
    )
    AND target_account_id IS NOT NULL
    AND is_account_member(target_account_id, min_role);
$$;

ALTER FUNCTION is_active_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_active_member(UUID, account_role_enum)
  TO authenticated, service_role;

-- Reescreve, mecanicamente, TODA policy de tabela de domínio que usa
-- is_account_member → is_active_member, preservando argumentos
-- (inclusive min_role) e o par USING/WITH CHECK. Cobre também as
-- tabelas adicionadas depois da 017 (notifications, ai_*,
-- quick_replies, meta_apps, …) sem depender de uma lista manual.
-- Idempotente: numa reexecução não resta policy com o nome antigo.
DO $$
DECLARE
  p RECORD;
  new_qual TEXT;
  new_check TEXT;
BEGIN
  FOR p IN
    SELECT policyname, tablename, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename NOT IN
        ('accounts', 'account_members', 'profiles', 'account_invitations')
      AND (
        qual LIKE '%is_account_member%'
        OR with_check LIKE '%is_account_member%'
      )
  LOOP
    new_qual  := replace(p.qual,       'is_account_member(', 'is_active_member(');
    new_check := replace(p.with_check, 'is_account_member(', 'is_active_member(');

    IF p.qual IS NOT NULL AND p.with_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)',
        p.policyname, p.tablename, new_qual, new_check
      );
    ELSIF p.qual IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (%s)',
        p.policyname, p.tablename, new_qual
      );
    ELSIF p.with_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I WITH CHECK (%s)',
        p.policyname, p.tablename, new_check
      );
    END IF;
  END LOOP;
END $$;

-- Verificação: nenhuma tabela de domínio pode ter sobrado com a
-- semântica antiga (aborta a migration se sobrou).
DO $$
DECLARE
  v_left INT;
BEGIN
  SELECT COUNT(*) INTO v_left
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename NOT IN
      ('accounts', 'account_members', 'profiles', 'account_invitations')
    AND (
      qual LIKE '%is_account_member%'
      OR with_check LIKE '%is_account_member%'
    );
  IF v_left > 0 THEN
    RAISE EXCEPTION
      'escopo ativo incompleto: % policies de domínio ainda usam is_account_member',
      v_left;
  END IF;
END $$;
