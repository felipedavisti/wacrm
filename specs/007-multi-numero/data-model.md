# Fase 1 — Modelo de Dados

Feature: `007-multi-numero`. Detalhe completo em `docs/spec-multi-numero.md`
(seção "Modelo de dados"). Resumo das mudanças (migrations `500_`+):

## Nova tabela: `meta_apps`

| Coluna | Tipo | Nota |
|---|---|---|
| id | UUID | PK |
| account_id | UUID | FK conta |
| app_id | TEXT | Meta App id |
| app_secret | TEXT | AES-256-GCM |
| verify_token | TEXT | AES-256-GCM |

## Alterações

| Tabela | Mudança | Motivo |
|---|---|---|
| `whatsapp_config` | dropar `UNIQUE(account_id)`; + `meta_app_id` FK | N números; secrets no App |
| `conversations` | + `whatsapp_config_id` NOT NULL | thread por número (decisão #2/#3) |
| `conversations` | índice dedupe → `(account_id, contact_id, whatsapp_config_id)` | **evitar fusão de threads** |
| `message_templates` | + `waba_id` | templates por WABA (decisão #4) |
| `broadcasts` | + `whatsapp_config_id` | número do disparo (decisão #5) |
| `flow_runs` | índice de run ativa: incluir o número | evitar atropelo entre números |

`UNIQUE(phone_number_id)` (013) permanece. `contacts` **não muda** (decisão #1).

## Invariantes

- Uma conversa pertence a exatamente um `whatsapp_config` (número).
- Um contato pode ter N conversas (uma por número).
- A resposta sai pelo `whatsapp_config_id` da conversa (nunca escolhido, exceto
  saída fria).
