-- ============================================================
-- 517_account_lead_sources (spec 009 — de-para por conta)
--
-- Substitui a tabela central `routing_map` (515) por um cadastro
-- POR CONTA, no mesmo padrão que já resolve o WhatsApp: a empresa
-- cadastra os números dela (`whatsapp_config.phone_number_id`
-- UNIQUE global) e o webhook resolve a conta sozinho. Aqui a empresa
-- cadastra as ORIGENS dela (formulários da Meta, filiais do site) e
-- a ingestão resolve a conta do mesmo jeito.
--
-- Por que é melhor que o mapa central:
--   - self-service: o admin da empresa gerencia, sem TI no meio;
--   - sem superfície cross-account (RLS normal por conta);
--   - simétrico ao WhatsApp — um conceito só para o time aprender.
--
-- O `meta_app_id` torna o enriquecimento DETERMINÍSTICO: o formulário
-- diz qual App da conta tem o token que consegue lê-lo. Com isso o
-- token global de ambiente deixa de existir.
--
-- DIVERGÊNCIA: aditivo + drop de tabela criada nesta mesma spec
-- (515), ainda sem uso em produção (Princípio V).
-- ============================================================

-- 1) Token de leads no App da Meta que a conta já cadastra (007).
--    Criptografado com a ENCRYPTION_KEY, como o app_secret ao lado.
ALTER TABLE meta_apps
  ADD COLUMN IF NOT EXISTS leads_access_token TEXT;

COMMENT ON COLUMN meta_apps.leads_access_token IS
  'Token da Graph API com permissão leads_retrieval, AES-256-GCM. '
  'Usado para enriquecer leads de formulário (spec 009): o webhook '
  'leadgen só entrega ids.';

-- 2) Origens de lead da conta.
CREATE TABLE IF NOT EXISTS account_lead_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Como esta origem é reconhecida no evento:
  --   form_id → formulário da Meta (o webhook manda o id)
  --   filial  → nome da filial que o formulário do site envia
  kind TEXT NOT NULL CHECK (kind IN ('form_id', 'filial')),
  value TEXT NOT NULL,

  -- Qual App da conta enriquece esta origem (só para form_id).
  meta_app_id UUID REFERENCES meta_apps(id) ON DELETE SET NULL,

  -- Funil/etapa de destino. NULL = funil de entrada padrão da conta.
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,

  -- Rótulo livre para a operação ("Formulário APH Salvador").
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE GLOBAL — a mesma proteção que `whatsapp_config.phone_number_id`
-- tem: duas empresas não podem reivindicar o mesmo formulário/filial,
-- senão o lead teria dois donos possíveis. Case-insensitive porque a
-- filial vem digitada de formulário ("São Luís" / "SÃO LUÍS").
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_lead_sources_value
  ON account_lead_sources (kind, lower(value));

CREATE INDEX IF NOT EXISTS ix_account_lead_sources_account
  ON account_lead_sources (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON account_lead_sources;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_lead_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE account_lead_sources ENABLE ROW LEVEL SECURITY;

-- Leitura por membros da empresa ativa; escrita só admin+ dela.
-- (Domínio ⇒ `is_active_member`, lição da 512.)
DROP POLICY IF EXISTS account_lead_sources_select ON account_lead_sources;
CREATE POLICY account_lead_sources_select ON account_lead_sources FOR SELECT
  USING (is_active_member(account_id));

DROP POLICY IF EXISTS account_lead_sources_write ON account_lead_sources;
CREATE POLICY account_lead_sources_write ON account_lead_sources FOR ALL
  USING (is_active_member(account_id, 'admin'))
  WITH CHECK (is_active_member(account_id, 'admin'));

-- 3) Migra o que existir do mapa central e o aposenta. `campaign` não
--    é migrado: não há origem que roteie por campanha (Site usa
--    filial, Meta usa form_id) — se um dia voltar, volta como novo
--    `kind` desta tabela.
INSERT INTO account_lead_sources (account_id, kind, value, pipeline_id, stage_id, active)
SELECT account_id, match_kind, match_value, pipeline_id, stage_id, active
FROM routing_map
WHERE match_kind IN ('form_id', 'filial')
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS routing_map;
