# Data Model — CTWA (Fase 1)

Aditivo sobre 007 (conversas/webhook) e 009 (ledger/deal). Migrations `516_`+.

## Entidade nova

### `ctwa_referrals` (vínculo wamid → campanha)

| Campo | Tipo | Notas |
|---|---|---|
| `wamid` | TEXT PK | id da mensagem WhatsApp que trouxe o referral |
| `conversation_id` | UUID FK | conversa (007) — chave de consulta/idempotência |
| `account_id` | UUID | account do número (desnormalizado; isolamento) |
| `campaign_id` / `campaign_name` | TEXT | atributos do anúncio |
| `adset_id` / `adset_name` | TEXT | |
| `ad_id` / `ad_name` | TEXT | |
| `meta_account_id` | TEXT | conta de anúncios |
| `source_url` / `ctwa_clid` | TEXT | |
| `raw` | JSONB | referral bruto preservado (FR-042) |
| `lead_ingestion_id` | UUID NULL | preenchido quando o lead é criado (idempotência) |
| `captured_at` | TIMESTAMPTZ | |

- Índice `(conversation_id)`. RLS: `is_account_member(account_id)`.
- **Idempotência (FR-040)**: no máximo **um** `lead_ingestion` por `conversation_id`
  (guard na criação; `lead_ingestion_id` marca que já foi criado).

## Reuso

- **Conversas / contatos (007)**: já existem; o lead CTWA vincula-se a eles (não cria
  contato/conversa novos).
- **`lead_ingestions` (009)**: um registro `source='meta_ctwa'`, `account_id` = o da
  conversa, `canonical` com os 6 campos de rastreamento; `contact_id`/`deal_id`
  preenchidos na entrega.
- **`deals` / funil (009)**: a entrega interna cria o `deal` no funil de entrada do
  account, vinculado ao contato/conversa, com `tracking` do referral.
- **Outbox (009)**: a criação do deal passa pelo `lead_delivery_jobs` (resiliência).

## Fluxo

```
webhook (007) recebe msg CTWA com referral
  → grava ctwa_referrals (wamid → campanha), account = conversa.account
  → se a conversa ainda não tem lead CTWA:
       cria lead_ingestions (meta_ctwa, account da conversa, 6 campos)
       → outbox 009 → deliver-internal cria o deal no funil (contato/conversa já existem)
       → marca ctwa_referrals.lead_ingestion_id (idempotência)
  → referral parcial → deal criado com pendência de atribuição (FR-007)
```

## Migrations planejadas (516_+)

1. `516_ctwa_referrals.sql` — tabela `ctwa_referrals` (+RLS/índice). A criação do lead
   reusa as tabelas do 009 (sem schema novo além desta).
