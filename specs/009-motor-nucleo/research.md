# Research — Motor de Leads Núcleo (Fase 0)

Decisões técnicas para o núcleo de ingestão/resiliência dentro do CRM
(Next.js + Supabase), reusando a área de Funil e a tenancy da 008.

## Decisões herdadas do programa (já fechadas)

- **Destino = CRM interno**, com **abstração por conta** (interno vs externo). Odoo/
  Chatwoot mortos. Ver [[programa-motor-leads]].
- **Stack**: Next.js 16 + Supabase/TS. **Sem Go.** A `spec.md` externa sobrevive;
  o `plan.md` externo (Go/Gin/Vite) é descartado.
- **Empresa = `account`** (fundação 008); RLS por `is_account_member`.

## D1 — Resiliência: outbox no Postgres + pg_cron (sem broker)

- **Decisão**: tabela **`lead_delivery_jobs`** (outbox durável, grão por lead×destino,
  com `status`/`next_attempt_at`/`attempts`/`lease_until`) + **pg_cron** disparando
  um worker a cada ~1min que reivindica jobs prontos com `SELECT … FOR UPDATE SKIP
  LOCKED` e tenta a entrega. Backoff exponencial por `next_attempt_at` (5 tentativas
  ≈ 1min/5min/15min/1h/3h).
- **Destino interno**: a entrega roda **dentro do Postgres** (plpgsql cria `contact`
  +`deal`) — sem HTTP, sem falha de rede; o job praticamente só falha por erro de
  dados. **Destino externo**: entrega via **pg_net** (HTTP no banco) ou **Edge
  Function** agendada.
- **Rationale**: volume baixo (milhares no total); a tabela-como-outbox é o padrão da
  spec externa e o mais "sem graça" (Constituição VII). **pgmq** está disponível no
  Supabase e pode substituir a fila se quisermos suas semânticas de dequeue, mas
  **não é necessário** neste volume — refinamento da nota do programa ([[programa-motor-leads]]).
- **Idempotência**: unique index em `leads.meta_lead_id` + `ON CONFLICT DO NOTHING`
  (FR-018); `uq (lead_id, destination)` no outbox evita duplicar perna.

## D2 — Ledger de ingestão separado do Funil

- **Decisão**: `lead_ingestions` (ledger canônico: contato+rastreamento normalizados,
  origem, empresa resolvida, `routing_status`, `overall_status`, tentativas, ponteiros
  `contact_id`/`deal_id` preenchidos na entrega) + `lead_raw_events` (payload cru
  imutável, FR-004). Ao entregar (destino interno), cria/atualiza `contact` e cria
  `deal` num `pipeline`, e o ledger passa a referenciá-los.
- **Rationale**: sustenta "nunca descartar" + reprocessamento + bruto, sem os quais um
  lead falho (sem deal ainda) não teria onde existir. O deal é a face do lead **no
  funil**; o ledger é a face de **resiliência/operação**. (Clarify Q2.)

## D3 — Destino interno reusa Funil; rastreamento em custom fields

- **Decisão**: destino interno = `contact` (dedup por telefone/e-mail no account) +
  `deal` (em `pipelines`/`pipeline_stages`, com `deals.contact_id`). Os 7 campos de
  rastreamento (ex-`ink_new_*`) ficam **no lead ledger (JSONB canônico)** e são
  **espelhados no deal** para exibição — via um `deals.tracking JSONB` e/ou definições
  em `custom_fields` do account. Exato ponto de anexação (JSONB no deal vs.
  `custom_fields`+valores) é detalhe a fechar na implementação; recomendação: `tracking
  JSONB` no deal (simples) + registrar as chaves como custom fields para exibição.
- **Vários funis por empresa** já suportados (`pipelines` por account). Ver D4.

## D4 — Roteamento resolve empresa + funil + estágio; leads não-roteados são centrais

- **Decisão**: `routing_map` (central/admin): `source?`, `campaign_match`,
  `account_id`, `pipeline_id?`, `stage_id?`, `active`. Resolve a empresa e,
  opcionalmente, o **funil-alvo** e **estágio inicial** (FR-015). Sem regra → lead fica
  `routing_status='pending'`, **sem account**, numa **fila central de não-roteados**.
- **Superfície central (exceção ao Q3)**: o `routing_map` e a fila de não-roteados são
  um **painel de admin/tráfego** de nível de deployment (decidir *qual* empresa é
  inerentemente cross-account). O **painel operacional é por empresa ativa** (Q3) e
  mostra só os leads já roteados àquela empresa. Acesso à superfície central é
  restrito (papel de admin/TI). **Decisão a validar com o PO** — flag no plano.

## D5 — Autenticação de ingestão (FR-037)

- **Decisão**: Meta lead form reusa o modelo de **assinatura de webhook + verify
  token** já existente (007, `meta_apps`/webhook). Site usa **token/secret
  compartilhado** por origem (header), validado por conta/origem. Falha de validação →
  rejeição registrada em `lead_rejected_events` (nunca vira lead).

## D6 — Config de destino por conta

- **Decisão**: `account_destination_config(account_id PK, kind 'internal'|'external',
  config JSONB, updated_at)`. Default implícito = interno quando não houver linha.
  Selecionada na entrega para escolher o adaptador.

## Numeração de migrations

008 usa `508`–`511`. A 009 segue em **`512_`+**. pg_cron/pg_net (e pgmq se usado)
habilitados via migration/painel. Divergências documentadas (Princípio V).

## Superfícies sensíveis (Constituição II — enumerar)

- Endpoints de ingestão (Site/Meta) — validação fail-closed (FR-037).
- Worker do outbox e entrega interna em plpgsql (SECURITY DEFINER) — deve carimbar o
  `account_id` correto (isolamento); auditar contra criar deal na empresa errada.
- pg_net/Edge Function do destino externo — segredos do destino criptografados.
- `routing_map`/fila central — acesso restrito a admin/TI.
