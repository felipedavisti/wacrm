-- ============================================================
-- 504_message_templates_waba (spec 007 — decisão #4)
--
-- Templates pertencem a uma WABA. Com N números em WABAs diferentes, o
-- seletor precisa filtrar pela WABA do número em questão, e o sync passa a
-- rodar por WABA (não uma vez por conta). Adiciona a coluna; a filtragem e o
-- sync-por-WABA são código (estágios seguintes).
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS waba_id TEXT;

CREATE INDEX IF NOT EXISTS idx_message_templates_waba
  ON message_templates(waba_id);
