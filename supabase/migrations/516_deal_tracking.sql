-- ============================================================
-- 516_deal_tracking (spec 009 — rastreamento de campanha no negócio)
--
-- Os 7 campos de rastreamento que hoje vivem no Odoo como
-- `ink_new_*` passam a viver no NEGÓCIO do nosso funil (decisão B4:
-- um JSONB no deal, em vez de 7 linhas de custom-field por lead).
--
-- Mapeamento (confirmado contra o fluxo n8n `RECEBE LEADS`):
--   campaign_name  → Campanha (utm.campaign)
--   adset_name     → ink_new_utmcampanha
--   adset_id       → ink_new_Id_Campanha
--   leadgen_id     → ink_new_ID_Lead
--   form_id        → ink_new_ID_Formulario      (não se aplica ao CTWA)
--   ad_id          → ink_new_Id_Criativo
--   ad_name        → ink_new_Criativo_Facebook
--
-- Guardar como JSONB (e não colunas) mantém a mudança ADITIVA sobre
-- a tabela `deals` do upstream — superfície de conflito mínima
-- (Princípio V) — e absorve campos novos de origens futuras sem
-- migration.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS tracking JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN deals.tracking IS
  'Rastreamento de aquisição (spec 009): campaign_name, adset_name, '
  'adset_id, leadgen_id, form_id, ad_id, ad_name, source, medium. '
  'Preenchido pela entrega do Motor de Leads; vazio para negócios '
  'criados manualmente.';

-- Consultas de performance por campanha ("quantos negócios vieram
-- do anúncio X"). GIN cobre qualquer chave sem índice por campo.
CREATE INDEX IF NOT EXISTS ix_deals_tracking
  ON deals USING GIN (tracking jsonb_path_ops);
