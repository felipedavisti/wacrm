-- ============================================================
-- 521_lead_recovery_runs (spec 011 — auditoria da recuperação)
--
-- A recuperação ativa pergunta à Meta "quais leads existem neste
-- período?" e importa os que faltam aqui. É a rede de contingência
-- para quando o webhook falhou, o token venceu, ou o formulário foi
-- criado sem ninguém avisar.
--
-- Por que auditar (FR-026): importar lead é criar oportunidade
-- comercial retroativa. Sem registro de quem rodou, quando, que
-- período e quantos vieram, uma reimportação vira discussão de "de
-- onde saíram esses 40 leads de ontem?" — e ninguém consegue
-- responder. O log torna a operação explicável.
--
-- DIVERGÊNCIA: tabela nova, aditiva (Princípio V).
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_recovery_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Quem mandou rodar. ON DELETE SET NULL: o usuário pode sair da
  -- empresa; o registro do que ele fez, não.
  run_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  mode TEXT NOT NULL CHECK (mode IN ('scan', 'import')),
  days INTEGER NOT NULL,

  -- Resultado. `found` = o que a Meta devolveu; `missing` = o que
  -- não existia aqui; `imported` = o que de fato entrou (só no modo
  -- import). A diferença entre missing e imported é o que falhou.
  forms_checked INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,

  -- Erro por formulário (token vencido, sem permissão), guardado
  -- para diagnóstico sem precisar do log do servidor.
  errors JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_lead_recovery_runs_account
  ON lead_recovery_runs (account_id, created_at DESC);

ALTER TABLE lead_recovery_runs ENABLE ROW LEVEL SECURITY;

-- Domínio ⇒ empresa ATIVA (lição da 512). Leitura para admin+:
-- é registro de operação, não de atendimento.
-- ESCRITA: nenhuma policy — só a rota grava, com service_role. Um
-- log de auditoria que o auditado pode editar não é auditoria.
DROP POLICY IF EXISTS lead_recovery_runs_select ON lead_recovery_runs;
CREATE POLICY lead_recovery_runs_select ON lead_recovery_runs FOR SELECT
  USING (is_active_member(account_id, 'admin'));

COMMENT ON TABLE lead_recovery_runs IS
  'Auditoria da recuperação ativa de leads na Meta (spec 011, FR-026).';
