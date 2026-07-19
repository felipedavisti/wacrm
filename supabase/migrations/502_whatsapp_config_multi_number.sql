-- ============================================================
-- 502_whatsapp_config_multi_number (spec 007)
--
-- Uma conta passa a ter N números. Dropa o UNIQUE(account_id) que a 017
-- criou (um número por conta). O UNIQUE(phone_number_id) da 013 PERMANECE —
-- um número pertence a uma config, globalmente (isso continua correto e é o
-- que o webhook usa para rotear a entrada).
--
-- Dropar a constraint NÃO quebra a entrada: o webhook roteia por
-- phone_number_id, não por account_id.
-- ============================================================

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
