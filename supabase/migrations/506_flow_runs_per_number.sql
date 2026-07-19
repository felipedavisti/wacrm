-- ============================================================
-- 506_flow_runs_per_number (spec 007 — FR-009)
--
-- O invariante "no máximo uma run ativa por contato" (índice parcial
-- idx_one_active_run_per_contact, migration 017: (account_id, contact_id)
-- WHERE active) foi escrito quando um contato tinha uma conversa. Com N
-- números o mesmo contato tem N threads — uma run ativa por número. Sem
-- incluir o número no índice, iniciar uma run no número Y atropelaria a run
-- ativa do número X (mesma colisão silenciosa das conversas).
-- ============================================================

-- Número da run, herdado da conversa. Nullable + backfill a partir da
-- conversa (que a 503 já carimbou).
ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

UPDATE flow_runs fr
SET whatsapp_config_id = c.whatsapp_config_id
FROM conversations c
WHERE c.id = fr.conversation_id
  AND fr.whatsapp_config_id IS NULL;

-- Trocar o índice parcial de run ativa para incluir o número.
DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact_number
  ON flow_runs(account_id, contact_id, whatsapp_config_id)
  WHERE status = 'active';
