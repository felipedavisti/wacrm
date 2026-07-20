# Contratos — Ingestão (pontos de entrada)

Endpoints públicos que recebem leads. **Fail-closed** na autenticação (FR-037):
evento inválido → 401/403 + registro em `lead_rejected_events`, nunca vira lead.
Todo evento aceito grava `lead_raw_events` **antes** de normalizar (FR-004/009).

## `POST /api/leads/ingest/site`

Formulário do site.

- **Auth**: header com token/secret compartilhado por origem (ex.: `X-Site-Token`);
  inválido → 401 + `lead_rejected_events(reason='invalid_token')`.
- **Body**: campos do formulário (nome, telefone, e-mail, `produto`, `filial?`, campanha…).
- **Efeito**: grava raw; normaliza; aplica dedup 24h (phone+email+produto, FR-017);
  resolve empresa via `routing_map`; se resolvido, enfileira entrega; se não,
  `routing_status='pending'` (fila central).
- **Resposta**: `202 { ingestion_id, dedup: 'created'|'suppressed', routing:
  'resolved'|'pending' }`. Duplicado em 24h → `suppressed` (vinculado ao original).

## `POST /api/leads/ingest/meta` (+ `GET` verify)

Meta lead form (Graph webhook).

- **Auth**: `GET` responde o desafio do verify token; `POST` valida `X-Hub-Signature-256`
  (reusa o modelo da 007/`meta_apps`); inválido → 401 +
  `lead_rejected_events(reason='invalid_signature')`.
- **Efeito**: grava raw; para cada leadgen, resolve os 7 campos de rastreamento;
  **idempotência absoluta por `meta_lead_id`** (FR-018) — reentrega não duplica;
  dedup form_id+phone+email (FR-019); resolve empresa; enfileira ou `pending`.
- **Resposta**: `200` (a Meta exige 200 rápido); processamento pesado via trabalho
  assíncrono/outbox.

## Normalização → canônico (FR-008)

Todo evento vira o modelo canônico único (contato + origem + rastreamento + empresa +
status) gravado em `lead_ingestions.canonical`, independente da origem.
