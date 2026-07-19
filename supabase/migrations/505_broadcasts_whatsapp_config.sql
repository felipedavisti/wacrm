-- ============================================================
-- 505_broadcasts_whatsapp_config (spec 007 — decisão #5)
--
-- Um disparo sai de um número específico (o wizard escolhe no passo 1). As
-- threads geradas caem naquele número. Adiciona a coluna; o passo do wizard
-- e o roteamento são código (estágios seguintes). Nullable para não quebrar
-- broadcasts existentes (single-número).
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;
