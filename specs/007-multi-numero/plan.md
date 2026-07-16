# Plano de Implementação: Múltiplos números por conta

**Branch**: `007-multi-numero` | **Data**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

## Resumo

Passar de um-número-por-conta para N. Adicionar `meta_apps` + `whatsapp_config.meta_app_id`,
dropar `UNIQUE(account_id)`, `conversations.whatsapp_config_id` (+ índice de dedupe
incluindo o número), `message_templates.waba_id`, `broadcasts.whatsapp_config_id`,
índice de `flow_runs`. Trocar a costura `resolveConfig` (001) para resolver por
conversa. Webhook multi-app (try-all-secrets). UI: settings vira lista, wizard de
broadcast e saída fria escolhem número. Detalhe em `docs/spec-multi-numero.md`.

## Contexto Técnico

**Stack**: TypeScript 6, Next.js 16, Postgres (Supabase)
**Design detalhado**: `docs/spec-multi-numero.md` (schema, call-sites, riscos).
**Pré-requisito**: costura `resolveConfig` da spec 001 (engine-send-base).
**Migrations**: faixa `500_`+ — ex.: `501_meta_apps.sql`,
`502_whatsapp_config_multi.sql`, `503_conversations_whatsapp_config.sql`,
`504_message_templates_waba.sql`, `505_broadcasts_whatsapp_config.sql`,
`506_flow_runs_index.sql` (nomes finais no /speckit-tasks).
**Áreas de código**: `whatsapp/webhook/route.ts` (roteamento já por
phone_number_id; add multi-app auth), `webhook-signature.ts` (try-all-secrets),
`send-message.ts` + `resolveConfig` (por conversa), `templates/*`, `broadcast-core.ts`,
`resolve-conversation.ts` (saída fria), settings (`whatsapp-config.tsx`), broadcast
wizard, inbox (indicar número).

## Constitution Check

| Princípio | Avaliação |
|---|---|
| **IV — Mudança dirigida por spec** | ✅ Axioma mudado via spec; 6 decisões de produto já fixadas. |
| **V — Disciplina de upstream** | ⚠️ Toca a área **mais quente** do upstream (webhook, whatsapp_config, índice 036). Divergência deliberada e **documentada** (doc + aqui). Migrations `500_`+. |
| **II — Segurança** | ✅ Webhook multi-app mantém fail-closed; secrets criptografados em `meta_apps`; isolamento reforçado pela 006. |
| **I — LGPD** | ✅ Threads por número mantêm o isolamento; nada de dado sensível novo exposto. |
| **III — Só API oficial** | ✅ Multi-app é o modelo oficial (WABAs assinam o App). |
| **VII — Manutenibilidade** | ✅ A costura da 001 concentra a mudança de envio num ponto. |

**Resultado**: PASSA, com a ressalva registrada do Princípio V (alto conflito de
merge — esperado e documentado).

## Estrutura do Projeto

Ver `docs/spec-multi-numero.md` seção "Modelo de dados" e "Mudanças de código"
para o mapa completo. Resumo:

```text
supabase/migrations/50x_*.sql     # meta_apps, whatsapp_config, conversations, templates, broadcasts, flow_runs
src/lib/whatsapp/
├── webhook-signature.ts          # try-all-secrets (multi-app)
├── send-message.ts + resolveConfig (por conversa)
├── resolve-conversation.ts       # saída fria (número escolhido)
└── templates/*                   # sync + seletor por WABA
src/app/api/whatsapp/webhook/route.ts   # auth multi-app
src/components/settings/whatsapp-config.tsx  # lista de números + meta_apps
src/components/broadcasts/*        # passo de número no wizard
src/components/inbox/*             # indicar número da conversa
```

## Complexity Tracking

| Divergência | Por quê | Alternativa rejeitada |
|---|---|---|
| Índice 036 alterado | threads por número exigem incluir whatsapp_config_id | manter (funde threads — inaceitável) |
| Webhook multi-app | números em Apps diferentes | um App só (limita o produto) |

## Fases

- **Fase 0/1**: o design já está em `docs/spec-multi-numero.md`; consolidar
  migrations e a ordem. Ponteiro CLAUDE.md.
- **Fase 2 (/speckit-tasks)**: tarefas por capacidade (US1–US6), com as migrations
  primeiro e a UI por último.
