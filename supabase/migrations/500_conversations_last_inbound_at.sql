-- ============================================================
-- 500_conversations_last_inbound_at
--
-- PRIMEIRA migration do fork (faixa 500_, Constitution Princípio V — o
-- upstream está em 036, então a faixa 500_ evita colisão de nome e de
-- ordem quando puxarmos migrations novas do upstream).
--
-- Feature 005 (janela de 24h): rastreia o horário da última mensagem de
-- ENTRADA (do cliente) por conversa. A "janela de 24h" da Meta é derivada
-- dela: aberta se a última entrada foi há menos de 24h, fechada caso
-- contrário (ou se nunca houve entrada). Preferimos uma coluna mantida
-- pelo webhook a varrer `messages` a cada envio.
-- ============================================================

-- Coluna: horário da última mensagem de ENTRADA (cliente) por conversa.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

-- Backfill: última mensagem de cliente conhecida (quando houver). Só onde
-- ainda nulo, para ser idempotente em re-execuções.
UPDATE conversations c
SET last_inbound_at = sub.max_created
FROM (
  SELECT conversation_id, MAX(created_at) AS max_created
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) sub
WHERE sub.conversation_id = c.id
  AND c.last_inbound_at IS NULL;

-- Sem RLS nova: a coluna herda as policies de `conversations`.
