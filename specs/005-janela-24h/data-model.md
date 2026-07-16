# Fase 1 — Modelo de Dados

Feature: `005-janela-24h`. **Uma migration** (faixa `500_`).

## Migration `500_conversations_last_inbound_at.sql`

```sql
-- Coluna: horário da última mensagem de ENTRADA (cliente) por conversa.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

-- Backfill: última mensagem de cliente conhecida (quando houver).
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
```

> Idempotente (`IF NOT EXISTS`; backfill só onde nulo). Sem RLS nova (a coluna
> herda as policies de `conversations`).

## Derivação da janela

- `isWindowOpen(last_inbound_at) = last_inbound_at != null && (now - last_inbound_at) < 24h`
- Nunca houve entrada (`null`) → **fechada**.

## Manutenção

- Webhook, ao inserir mensagem de `sender_type='customer'`, faz
  `update conversations set last_inbound_at = now()` (junto do `last_message_at`
  que já atualiza).
