# Implementation Plan: Motor de Leads — Núcleo

**Branch**: autoria em `008-multi-conta`; implementação em branch própria a partir da `main` já com a 008. | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

## Summary

Centralizar a ingestão de leads (Site + Meta Form) dentro do CRM, normalizar num
**ledger canônico**, rotear por **empresa (account)** via de-para gerenciável, e
entregar ao **destino interno** (criar `contact` + `deal` num funil, rastreamento em
custom fields) — com **resiliência compartilhada** (outbox no Postgres + pg_cron,
retry 5x com backoff, "nunca descartar", idempotência) e um **painel de
reprocessamento** por empresa ativa. A camada de destino é **plugável e configurável
por conta** (interno vs externo). Depende da fundação 008 (empresa = account; RLS).

## Technical Context

**Language/Version**: TypeScript 5 / Node (Next.js 16, App Router).

**Primary Dependencies**: Supabase (Postgres 15 + RLS + **pg_cron**, **pg_net** para
destino externo; **pgmq** opcional), Next.js route handlers, Tailwind, i18n pt-BR/en.

**Storage**: PostgreSQL. Novas tabelas de motor (`lead_ingestions`, `lead_raw_events`,
`lead_rejected_events`, `lead_delivery_jobs`, `lead_delivery_attempts`, `routing_map`,
`account_destination_config`); reuso de `contacts`/`pipelines`/`deals`/`custom_fields`.

**Testing**: Vitest (unit + integração de ingestão/worker/dedup/idempotência); reuso
da suíte de tenancy (isolamento por account).

**Target Platform**: Web (deploy por cliente; Supabase Cloud). Worker roda como
função agendada por pg_cron dentro do Postgres.

**Project Type**: Web application (Next.js + Supabase), monorepo único.

**Performance Goals**: volume baixo (milhares no total); painel ≤ 30s (SC-006);
throughput de saída limitado de propósito (protege destinos externos).

**Constraints**: nunca descartar (SC-001); idempotência Meta; 5 tentativas backoff;
destinos plugáveis por conta; segregação por account (RLS 008); ingestão fail-closed
(FR-037); sem broker externo; migrations `512_`+.

**Scale/Scope**: 2 origens + 2 tipos de destino; ~7 tabelas novas; painel + fila
central; worker outbox.

## Constitution Check

| Princípio | Avaliação | Status |
|---|---|:--:|
| I. Privacidade/LGPD | PII de leads (nome/telefone/e-mail) + payload bruto retidos em claro, protegidos por acesso restrito por empresa (RLS). Inventário de operadores inalterado (só Meta + Supabase). Sem novo operador externo por padrão (destino interno). Anonimização = decisão futura, não bloqueia. | ✅ |
| II. Segurança = autorização (RLS) | Tabelas novas com RLS ancorado em `account`. **Superfícies sensíveis**: endpoints de ingestão (fail-closed, FR-037); worker/entrega interna em plpgsql (SECURITY DEFINER) DEVE carimbar o account resolvido — auditar contra criar deal na empresa errada; `routing_map`/fila central restrita a admin; segredos de destino externo criptografados (AES-256-GCM). Revisão obrigatória antes do merge. | ✅ (com revisão) |
| III. Só API oficial WhatsApp | Não toca no canal (CTWA é 010). Meta lead form via Graph oficial. | ✅ |
| IV. Mudança dirigida por spec | Introduz um subsistema (motor) — via spec/plan/tasks; decisões de produto no clarify. | ✅ |
| V. Disciplina de merge com upstream | Tudo aditivo (tabelas/rotas novas; `deals.tracking` é coluna nova). Migrations `512_`+. Divergências documentadas. | ✅ |
| VI. Hospedagem/isolamento | Sem mudança; usa extensões gerenciadas do Supabase (pg_cron/pg_net). | ✅ |
| VII. Manutenibilidade | Outbox-como-tabela + pg_cron é o padrão "sem graça" (sem broker). Reuso máximo (funil, custom fields, webhook/meta_apps da 007). | ✅ |

**Resultado**: PASS. Obrigações: revisão de segurança (II) do worker/ingestão;
documentar divergências (V). A **superfície central** (routing_map + fila de
não-roteados) como exceção ao escopo por-empresa-ativa (D4) foi **decidida (B1=A)** —
tela de admin/TI, não "account de staging".

## Project Structure

```text
supabase/migrations/
├── 512_lead_core.sql            # ledger + raw + rejected (+RLS)
├── 513_lead_outbox.sql          # delivery_jobs/attempts + pg_cron worker (SKIP LOCKED, backoff)
├── 514_routing_map.sql          # routing_map (RLS admin) + account_destination_config
└── 515_deal_tracking.sql        # deals.tracking JSONB + seed custom_fields de rastreamento

src/
├── app/api/leads/
│   ├── ingest/site/route.ts     # POST ingestão site (token)
│   ├── ingest/meta/route.ts     # GET verify + POST ingestão meta (assinatura)
│   ├── route.ts                 # GET lista (painel, empresa ativa)
│   ├── [id]/route.ts            # GET detalhe (bruto + tentativas)
│   ├── reprocess/route.ts       # POST reenvio individual/lote
│   └── metrics/route.ts         # GET indicadores do dia
├── app/api/account/lead-destination/route.ts  # GET/PUT destino por conta
├── lib/leads/
│   ├── normalize.ts             # evento → canônico (por origem)
│   ├── dedup.ts                 # chaves de dedup (site 24h / meta)
│   ├── routing.ts               # resolve empresa (+funil/estágio) via routing_map
│   ├── deliver-internal.ts      # cria contact + deal (funil) + tracking
│   └── outbox.ts                # enfileirar/reprocessar jobs
├── components/leads/            # painel (lista, detalhe, reprocessar, métricas)
├── components/admin/routing/    # superfície central: routing_map + fila não-roteados
└── i18n / messages/             # rótulos pt-BR/en
```

**Structure Decision**: monorepo web único. Customização **aditiva** (todo o motor em
arquivos/rotas novos; reuso de `contacts`/`pipelines`/`deals`/`custom_fields` e do
modelo de webhook/`meta_apps` da 007). O worker vive no Postgres (pg_cron) para não
exigir processo sempre-ligado.

## Complexity Tracking

> Sem violações. A "superfície central" (D4) é a única exceção ao escopo por empresa
> ativa — justificada (decidir *qual* empresa é inerentemente cross-account) e restrita
> a admin/TI. **Decidida (B1=A)** — não usar "account de staging". Sem broker (nota
> reversível: migrar `lead_delivery_jobs` para pgmq se o volume crescer ordens de
> magnitude).
