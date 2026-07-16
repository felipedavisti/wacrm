# Fase 1 — Modelo de Dados

Feature: `004-conversas-na-ficha`. **Sem migration.**

## `conversations` (existente)

| Coluna | Uso na ficha |
|---|---|
| `contact_id` | filtro (conversas deste contato) |
| `status` | badge de status |
| `last_message_text` | prévia |
| `last_message_at` | ordenação (desc) + data exibida |
| `unread_count` | indicador de não-lidas |
| `whatsapp_config_id` | *(futuro multi-número)* identificar o número |

## Exibição

- Lista de conversas do contato, account-scoped, ordenada por `last_message_at` desc.
- Cada item → link `/inbox?c=<id>`.
- Vazio → estado "sem conversas".
