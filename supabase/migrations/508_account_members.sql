-- ============================================================
-- 508_account_members (spec 008 — multi-conta)
--
-- Derruba a invariante "1 account por usuário" (migration 017):
-- a pertença passa a viver em `account_members` (N-para-N, papel por
-- vínculo), e `profiles.account_id` é RESSIGNIFICADO como a "conta
-- ATIVA" do usuário (ponteiro mutável, NULLABLE) — assim
-- getCurrentAccount() e todas as policies de RLS existentes seguem
-- funcionando sem alteração.
--
-- DIVERGÊNCIA DELIBERADA do upstream (Princípio V da Constituição):
--   - dropa `idx_accounts_one_per_owner` (um usuário pode ser owner
--     de N empresas);
--   - `profiles.account_id`/`account_role` deixam de ser NOT NULL
--     (NULL = estado "sem empresa", FR-023);
--   - `account_invitations.position` (cargo de vendas do convite).
-- Registrada no runbook de sync.
-- ============================================================

-- 1) Fonte de verdade da pertença: um vínculo por (empresa, usuário),
--    com papel de permissão (enum existente) e cargo de vendas
--    opcional (spec 008, FR-022 — permissão fina fica para depois).
CREATE TABLE IF NOT EXISTS account_members (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role account_role_enum NOT NULL,
  position TEXT CHECK (position IN ('sdr', 'closer', 'vendedor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id)
);

-- Seletor de empresas do usuário / listagem do time da empresa.
CREATE INDEX IF NOT EXISTS idx_account_members_user
  ON account_members(user_id);
CREATE INDEX IF NOT EXISTS idx_account_members_account
  ON account_members(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON account_members;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: qualquer MEMBRO da conta vê o time dela (o roster de membros
-- é visível a agent/viewer em modo leitura — comportamento de produto
-- herdado da 017); só admin+ escreve. Ver o próprio vínculo está
-- coberto: ser membro da conta implica is_account_member verdadeiro.
-- Escritas sensíveis (último owner etc.) passam pelas RPCs SECURITY
-- DEFINER (migration 510), que aplicam guardas adicionais.
-- Nota de recursão: is_account_member é SECURITY DEFINER owned by
-- postgres, então a leitura de account_members dentro da função NÃO
-- reavalia estas policies (mesmo padrão da 017 com profiles).
ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_members_select ON account_members;
CREATE POLICY account_members_select ON account_members FOR SELECT
  USING (is_account_member(account_id));

-- ESCRITA: NENHUMA policy — negada por padrão no cliente. Toda
-- mutação de pertença passa pelas RPCs SECURITY DEFINER (510), que
-- carregam as guardas (último owner, transferência 1-por-1, papel do
-- chamador). Uma policy de escrita "admin+" aqui permitiria, por
-- exemplo, um admin se autopromover a owner com um UPDATE direto via
-- PostgREST, contornando as guardas — achado da revisão de segurança
-- da 008 (Princípio II: fail-closed).

-- 2) Backfill (FR-004): todo usuário atual tem exatamente 1 conta —
--    o vínculo equivalente nasce daqui, com o mesmo papel. Idempotente.
INSERT INTO account_members (account_id, user_id, role)
SELECT p.account_id, p.user_id, p.account_role
FROM profiles p
WHERE p.account_id IS NOT NULL
  AND p.account_role IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;

-- Cinto: garante que o dono de referência de cada conta tem vínculo
-- de owner mesmo se o profile dele estiver órfão/apontando alhures.
INSERT INTO account_members (account_id, user_id, role)
SELECT a.id, a.owner_user_id, 'owner'
FROM accounts a
ON CONFLICT (account_id, user_id) DO NOTHING;

-- Verificação do backfill (aborta a migration se algo ficou de fora):
-- nenhum profile com conta pode ficar sem o vínculo correspondente.
DO $$
DECLARE
  v_missing INT;
BEGIN
  SELECT COUNT(*) INTO v_missing
  FROM profiles p
  WHERE p.account_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM account_members m
      WHERE m.account_id = p.account_id AND m.user_id = p.user_id
    );
  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'backfill de account_members incompleto: % profiles sem vínculo',
      v_missing;
  END IF;
END $$;

-- 3) Owner de múltiplas empresas (FR-009): cai o índice único.
DROP INDEX IF EXISTS idx_accounts_one_per_owner;

-- 4) profiles.account_id vira a conta ATIVA (nullable; NULL = "sem
--    empresa"). account_role acompanha (papel NA conta ativa,
--    denormalizado de account_members — re-sincronizado na troca).
ALTER TABLE profiles ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN account_role DROP NOT NULL;

-- 4b) CRÍTICO: a FK da 017 era ON DELETE CASCADE — sob 1 conta por
--     usuário, apagar a conta apagava o profile junto. No multi-conta
--     isso destruiria o profile de quem também pertence a OUTRAS
--     empresas. Excluir uma empresa agora apenas zera o ponteiro de
--     conta ativa (SET NULL); o próximo acesso cai em outra empresa
--     com vínculo ou no estado "sem empresa" (FR-023).
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_account_id_fkey;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

-- 4c) SEGURANÇA (Princípio II): a policy `profiles_update` (017)
--     permite ao usuário editar a PRÓPRIA linha — inclusive
--     `account_role`/`account_id`. Na 017 isso era escalação real
--     (o is_account_member antigo LIA profiles.account_role); no
--     modelo novo o RLS é seguro (lê account_members), mas o denorm
--     forjado ainda enganaria as checagens de camada de app
--     (requireRole). Este trigger fecha o buraco: os dois campos só
--     mudam por caminhos SECURITY DEFINER (as RPCs da 510, que rodam
--     como postgres) — nunca por um UPDATE direto do cliente.
CREATE OR REPLACE FUNCTION public.guard_profile_account_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.account_role IS DISTINCT FROM OLD.account_role)
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    RAISE EXCEPTION
      'account_id/account_role can only change via membership RPCs'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_account_fields ON profiles;
CREATE TRIGGER guard_profile_account_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_account_fields();

-- 5) O convite pode carregar o cargo de vendas (FR-006/FR-022).
ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS position TEXT
    CHECK (position IN ('sdr', 'closer', 'vendedor'));

-- 6) Visibilidade de profiles no multi-conta. A policy da 017 era
--    `is_account_member(profiles.account_id)` — mas account_id agora
--    é a conta ATIVA do usuário, então um colega cuja conta ativa é
--    OUTRA empresa sumiria do roster. Passa a ser: vejo o meu profile
--    e o de quem compartilha PELO MENOS UMA empresa comigo (via
--    account_members).
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM account_members m
      WHERE m.user_id = profiles.user_id
        AND is_account_member(m.account_id)
    )
  );
