-- ============================================================
-- 515_routing_map (spec 009 — roteamento + destino por conta)
--
-- Duas tabelas de configuração:
--
--   routing_map              — de-para ORIGEM → EMPRESA (+ funil).
--                              Superfície CENTRAL (admin/TI): decidir
--                              *qual* empresa recebe o lead é
--                              inerentemente cross-account, então não
--                              pertence a nenhuma empresa (decisão
--                              B1=A da spec).
--   account_destination_config — para onde vão os leads DAQUELA
--                              empresa (interno vs externo, FR-036).
--                              Config por conta, gerida pelo admin dela.
--
-- Chave de casamento por origem (payloads reais de produção):
--   Site → `filial` (o formulário já envia "São Luís")
--   Meta → `form_id` (cada formulário pertence a uma filial)
-- ============================================================

CREATE TABLE IF NOT EXISTS routing_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- NULL = regra vale para qualquer origem.
  source TEXT CHECK (source IN ('site', 'meta_form', 'meta_ctwa')),

  match_kind TEXT NOT NULL CHECK (match_kind IN ('filial', 'form_id', 'campaign')),
  match_value TEXT NOT NULL,

  -- Empresa de destino do lead.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Funil/estágio alvo (FR-015). NULL = funil de entrada padrão da
  -- empresa — é o que viabiliza "cada função tem seu funil".
  pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,

  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma regra ativa por (origem, tipo, valor) — evita ambiguidade de
-- roteamento (dois destinos para a mesma campanha/filial).
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_map_match
  ON routing_map (COALESCE(source, ''), match_kind, lower(match_value))
  WHERE active;

CREATE INDEX IF NOT EXISTS ix_routing_map_account
  ON routing_map (account_id);

DROP TRIGGER IF EXISTS set_updated_at ON routing_map;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON routing_map
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS sem policies: superfície CENTRAL, servida por rotas de
-- service_role com gate de admin na aplicação. Deny-by-default para
-- o cliente (Princípio II) — nenhuma empresa "vê" o mapa de
-- roteamento das outras, nem por acidente.
ALTER TABLE routing_map ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- Destino por conta (FR-036). Sem linha ⇒ destino interno (o
-- padrão): o lead vira contact + deal no funil da empresa.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_destination_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal', 'external')),
  -- Config do destino externo. Segredos DEVEM ser gravados
  -- criptografados (AES-256-GCM) pela camada de aplicação, como os
  -- tokens de WhatsApp (Constituição II).
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON account_destination_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_destination_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE account_destination_config ENABLE ROW LEVEL SECURITY;

-- Leitura por membros da empresa ativa; escrita só admin+ dela.
DROP POLICY IF EXISTS account_destination_config_select
  ON account_destination_config;
CREATE POLICY account_destination_config_select
  ON account_destination_config FOR SELECT
  USING (is_active_member(account_id));

DROP POLICY IF EXISTS account_destination_config_write
  ON account_destination_config;
CREATE POLICY account_destination_config_write
  ON account_destination_config FOR ALL
  USING (is_active_member(account_id, 'admin'))
  WITH CHECK (is_active_member(account_id, 'admin'));
