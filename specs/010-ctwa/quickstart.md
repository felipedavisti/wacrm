# Quickstart — CTWA

Requer **007** (webhook/inbox WhatsApp), **008** (empresa=account) e **009** (ledger,
deal no funil, outbox) aplicados. Migration `516_`.

## Cenário 1 — Captura de referral (US1)

- Enviar ao webhook (assinatura válida) uma 1ª mensagem CTWA com `referral`.
- Verificar: linha em `ctwa_referrals` (wamid → campanha), `account_id` = o da conversa;
  o `raw` preservado. Mensagem sem `referral` → nada capturado.

## Cenário 2 — Lead criado automaticamente (US2)

- Após a captura, verificar (após o tick do outbox 009) um `deal` no funil de entrada
  do account, vinculado ao contato/conversa, com os 6 campos de rastreamento.
- Enviar mais mensagens na mesma conversa → **não** cria segundo deal (idempotência).

## Cenário 3 — Referral parcial (US3)

- Enviar referral faltando campos → deal criado com o disponível + **pendência de
  atribuição** sinalizada; campo tardio → completa a atribuição.

## Cenário 4 — Isolamento

- A conversa de outro número/empresa gera o lead no **account correto**; nenhum
  vazamento entre empresas (reusa RLS 008).

## Testes esperados

- Captura só com `referral`; fail-closed reusa 007.
- Criação automática idempotente por conversa; entrega via outbox 009.
- Empresa = account da conversa (sem de-para); atribuição parcial sinalizada.
