-- ============================================================
-- 503_conversations_per_number (spec 007 — o RISCO CENTRAL)
--
-- Uma conversa passa a pertencer a exatamente um número. A identidade de
-- dedupe da conversa (migration 036: UNIQUE(account_id, contact_id)) DEVE
-- incluir o número — senão mensagens de dois números do mesmo contato
-- COLAPSAM silenciosamente na mesma thread (decisões de produto #2/#3).
--
-- Divergência deliberada do upstream: substitui o índice da 036 (a mudança
-- mais recente deles, de 10/07). Registrada no runbook de sync (Princípio V).
-- ============================================================

-- 1) Coluna do número da conversa.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE CASCADE;

-- 2) Backfill: antes do multi-número toda conta tinha exatamente 1 config,
--    então cada conversa existente pertence a esse número. Só onde nulo.
UPDATE conversations c
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE wc.account_id = c.account_id
  AND c.whatsapp_config_id IS NULL;

-- 3) Trocar o índice de dedupe: (account_id, contact_id) →
--    (account_id, contact_id, whatsapp_config_id). Mantém "uma thread por
--    (conta, contato, número)" — o backstop de nível de banco contra fusão.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_number
  ON conversations (account_id, contact_id, whatsapp_config_id);

-- NOT NULL fica para uma migration futura, depois de todo ambiente confirmar
-- o backfill 100% (add-nullable → backfill → enforce). O invariante é mantido
-- em código: webhook e saída fria sempre gravam whatsapp_config_id em novas
-- conversas. (Postgres trata NULL como distinto no índice único, então
-- eventuais linhas legadas sem número não fundem indevidamente.)
