# Fase 1 — Modelo de Dados

Feature: `003-auditoria-acesso`. **Sem alteração de schema** — usa colunas
existentes.

## `messages` (existente, sem migration)

| Coluna | Tipo | Papel nesta feature |
|---|---|---|
| `sender_type` | TEXT ('customer'/'agent'/'bot') | inalterado |
| `sender_id` | UUID (nullable) | **passa a ser preenchido** nos envios de agente |

Regras de preenchimento de `sender_id`:
- `sender_type='agent'` (envio manual) → id do agente autenticado.
- `sender_type='bot'` → nulo.
- `sender_type='customer'` → nulo.
- envio via API pública (sem agente) → nulo.

## Resolução de exibição

- `sender_id` → nome do agente via **membros da conta** (`profiles`/account
  members) já carregados na inbox.
- `sender_id` nulo ou ex-membro → exibição degradada ("autor desconhecido"/sem
  autor), sem erro.

## Contrato público (invariante)

- `ApiMessage` (`src/lib/api/v1/conversations.ts`) **não** inclui `sender_id` —
  DEVE permanecer assim (FR-005).
