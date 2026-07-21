-- ============================================================
-- 513_lead_core (spec 009 — núcleo do Motor de Leads)
--
-- O ledger de ingestão: onde todo lead recebido passa a existir
-- ANTES de qualquer tentativa de entrega (Princípio "nunca
-- descartar", FR-004/009/010). É a face de RESILIÊNCIA do lead; a
-- face de NEGÓCIO é o `deal` no funil, criado na entrega.
--
-- Escopo de visão (lição da 008/512): tabelas de domínio usam
-- `is_active_member` — o painel de leads mostra só a empresa ATIVA.
-- Leads ainda sem empresa (`account_id IS NULL`, pendência de
-- roteamento) não pertencem a conta nenhuma e ficam invisíveis ao
-- cliente por construção: vivem na superfície central (admin/TI),
-- servida por service_role.
--
-- DIVERGÊNCIA: tabelas novas, aditivas (Princípio V).
-- ============================================================

-- ------------------------------------------------------------
-- Lead canônico (ledger)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_ingestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Empresa resolvida pelo roteamento. NULL = pendência de
  -- roteamento (campanha/filial sem de-para) — nunca descarte.
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,

  source TEXT NOT NULL CHECK (source IN ('site', 'meta_form', 'meta_ctwa')),
  medium TEXT,

  -- Idempotência absoluta da Meta (FR-018): o mesmo leadgen_id nunca
  -- vira dois leads, venha de webhook ou de recuperação ativa (011).
  meta_lead_id TEXT,

  -- Dedup secundária por origem (FR-017/019):
  --   Site: hash(cpf | telefone+email) + produto, com janela de 24h
  --   Meta: hash(form_id + telefone + email), SEM janela
  dedup_key TEXT,

  -- Contato + rastreamento normalizados (o modelo canônico único,
  -- FR-008). Guarda também o field_data bruto da Meta e as
  -- perguntas/respostas do formulário.
  canonical JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Funil/estágio alvo resolvidos pelo de-para (FR-015). NULL =
  -- usar o funil de entrada padrão da empresa na hora da entrega.
  target_pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  target_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,

  routing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (routing_status IN ('pending', 'resolved')),
  overall_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (overall_status IN ('pending', 'sent', 'partially_sent', 'failed')),

  -- Preenchidos na entrega interna (o lead vira negócio no funil).
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência da Meta — o índice É a garantia (FR-018).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_ingestions_meta_lead_id
  ON lead_ingestions (meta_lead_id) WHERE meta_lead_id IS NOT NULL;

-- Dedup por janela: a busca é sempre (chave, recente primeiro).
CREATE INDEX IF NOT EXISTS ix_lead_ingestions_dedup
  ON lead_ingestions (dedup_key, created_at DESC) WHERE dedup_key IS NOT NULL;

-- Painel: filtros combinados por origem/status/período na empresa.
CREATE INDEX IF NOT EXISTS ix_lead_ingestions_panel
  ON lead_ingestions (account_id, overall_status, source, created_at DESC);

-- Fila central de não-roteados.
CREATE INDEX IF NOT EXISTS ix_lead_ingestions_unrouted
  ON lead_ingestions (created_at DESC) WHERE routing_status = 'pending';

DROP TRIGGER IF EXISTS set_updated_at ON lead_ingestions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_ingestions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lead_ingestions ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da empresa ATIVA (painel por empresa).
-- Escrita: nenhuma policy — ingestão e worker rodam em service_role;
-- o reprocessamento passa por RPC. Deny-by-default (Princípio II).
DROP POLICY IF EXISTS lead_ingestions_select ON lead_ingestions;
CREATE POLICY lead_ingestions_select ON lead_ingestions FOR SELECT
  USING (account_id IS NOT NULL AND is_active_member(account_id));

-- ------------------------------------------------------------
-- Evento bruto imutável (FR-004). Preservado SEMPRE — inclusive
-- quando a normalização ou a entrega falham, e para os eventos
-- suprimidos por dedup (que apontam para o lead original, FR-020).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_raw_events (
  id BIGSERIAL PRIMARY KEY,
  ingestion_id UUID REFERENCES lead_ingestions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  headers JSONB,
  -- true = deduplicado (não gerou lead novo); `ingestion_id` aponta
  -- para o lead original que o absorveu.
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_lead_raw_events_ingestion
  ON lead_raw_events (ingestion_id, received_at DESC);

ALTER TABLE lead_raw_events ENABLE ROW LEVEL SECURITY;

-- Visível junto com o lead a que pertence (o detalhe do painel
-- mostra o payload bruto, FR-029). Mesma técnica de policy-por-pai
-- que a 001 usa em contact_tags — evita denormalizar account_id
-- numa tabela append-only escrita antes de o roteamento existir.
DROP POLICY IF EXISTS lead_raw_events_select ON lead_raw_events;
CREATE POLICY lead_raw_events_select ON lead_raw_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lead_ingestions i
      WHERE i.id = lead_raw_events.ingestion_id
        AND i.account_id IS NOT NULL
        AND is_active_member(i.account_id)
    )
  );

-- ------------------------------------------------------------
-- Eventos REJEITADOS na autenticação da ingestão (FR-037).
-- Nunca viram lead; registrados para diagnóstico — "não descartar
-- silenciosamente a informação de que houve tentativa inválida".
-- Superfície central (admin/TI): sem policy → service_role apenas.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_rejected_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB,
  headers JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_lead_rejected_events_recent
  ON lead_rejected_events (received_at DESC);

ALTER TABLE lead_rejected_events ENABLE ROW LEVEL SECURITY;
