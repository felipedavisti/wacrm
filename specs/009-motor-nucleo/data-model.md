# Data Model — Motor de Leads Núcleo (Fase 1)

PostgreSQL (Supabase, `sa-east-1`). RLS em toda tabela nova. Migrations `512_`+.
Empresa = `account` (008). Retenção indefinida (FR-035).

## Entidades novas

### `lead_ingestions` (ledger canônico do motor)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `account_id` | UUID NULL | empresa resolvida; NULL enquanto `routing_status='pending'` |
| `source` | TEXT | `site` \| `meta_form` (CTWA em 010) |
| `medium` | TEXT NULL | ex.: `Trafego Pago` |
| `meta_lead_id` | TEXT NULL | idempotência absoluta Meta (FR-018) |
| `dedup_key` | TEXT NULL | Site: hash(phone+email+produto) 24h (FR-017); Meta: hash(form_id+phone+email) (FR-019) |
| `canonical` | JSONB | contato + rastreamento (7 campos) normalizados |
| `routing_status` | TEXT | `pending` \| `resolved` |
| `overall_status` | TEXT | `pending` \| `sent` \| `partially_sent` \| `failed` |
| `contact_id` | UUID NULL | preenchido na entrega interna |
| `deal_id` | UUID NULL | preenchido na entrega interna |
| `created_at`/`updated_at` | TIMESTAMPTZ | |

- Índices: `uq (meta_lead_id) WHERE NOT NULL`; `(dedup_key, created_at) WHERE NOT NULL`;
  `(account_id, overall_status, source, created_at)` (painel).
- RLS: `account_id IS NOT NULL AND is_account_member(account_id)` (painel por empresa).
  Leads `pending` (account NULL) **não** aparecem no painel de conta — vivem na
  superfície central (ver `routing_map`/fila de não-roteados; acesso admin/TI).

### `lead_raw_events` (payload cru imutável — FR-004)

`id BIGSERIAL`, `ingestion_id UUID NULL` (para suprimido por dedup, aponta ao
original — FR-020), `source TEXT`, `payload JSONB`, `headers JSONB`, `suppressed BOOL`,
`received_at`. Append-only.

### `lead_rejected_events` (FR-037)

`id BIGSERIAL`, `source`, `reason` (`invalid_signature`|`invalid_token`|…), `payload`,
`headers`, `received_at`. Registrado para diagnóstico; nunca vira lead.

### `lead_delivery_jobs` (outbox / fila durável)

`id UUID PK`, `ingestion_id UUID FK`, `destination TEXT` (`internal`|`external`),
`account_id UUID` (desnormalizado), `status` (`pending`|`processing`|`succeeded`|`failed`),
`attempts INT`, `max_attempts INT DEFAULT 5`, `next_attempt_at TIMESTAMPTZ`,
`locked_by TEXT`, `lease_until TIMESTAMPTZ`, `external_ref TEXT` (deal_id/id externo),
`last_error TEXT`. `uq (ingestion_id, destination)`. Índice
`(next_attempt_at) WHERE status IN ('pending','processing')`.

### `lead_delivery_attempts` (histórico append-only — FR-016/029)

`id BIGSERIAL`, `job_id UUID FK`, `attempt_no INT`, `started_at`, `finished_at`,
`outcome` (`success`|`error`), `error_class` (`retryable`|`permanent`), `reason TEXT`.

### `routing_map` (de-para central origem → empresa[+funil]) — FR-011/012/015

`id UUID PK`, `source TEXT NULL`, `match_kind TEXT` (`filial`|`form_id`),
`match_value TEXT` (ex.: `São Luís` para Site; `1009161721845263` para Meta),
`account_id UUID FK`, `pipeline_id UUID NULL`, `stage_id UUID NULL`, `active BOOL`,
`updated_by UUID`, `updated_at`. **Superfície central** (admin/TI) — RLS restrita a
admin (não por empresa ativa). **Site casa por `filial`; Meta por `form_id`** (cada
formulário pertence a uma filial/empresa — mapaFilial atual SSA/FSA/LNAP).

> `dedup_key` do Site inclui `cpf` (B2): hash(cpf | telefone+email) + produto, janela 24h.

### Custom fields do lead (contato)

Os campos do Site `cpf`, `data_nascimento`, `sexo`, `estado_civil` e o `produto` são
gravados como **`custom_fields`/valores** do contato (reuso da infra existente).
`cpf` é **PII sensível** (LGPD): retido em claro nesta fase, protegido por RLS/acesso
por empresa; anonimização/mascaramento = decisão futura (não bloqueia).

### `account_destination_config` (destino por conta — FR-036)

`account_id UUID PK FK`, `kind TEXT` (`internal`|`external`), `config JSONB` (segredos
do destino externo criptografados), `updated_at`. Sem linha ⇒ interno.

## Reuso de entidades existentes (destino interno)

- `contacts` (dedup por telefone/e-mail no account) — cria/atualiza.
- `pipelines` / `pipeline_stages` / `deals` — cria o `deal` (funil-alvo do de-para ou
  funil de entrada padrão); `deals.contact_id` vincula o contato.
- Rastreamento: `deals.tracking JSONB` (novo campo) + chaves registráveis como
  `custom_fields` do account para exibição. (Alternativa: tabela de valores por deal.)

## Estados

- **`routing_status`**: `pending` (sem de-para → não enfileira entrega; fila central) →
  `resolved` (empresa definida → enfileira `lead_delivery_jobs`).
- **`overall_status`** (derivado dos jobs): `pending` → `sent` (todas as pernas
  sucesso) | `partially_sent` (mistura, só com >1 destino) | `failed` (perna esgotou
  tentativas). Com destino único, `partially_sent` é inerte.
- **`lead_delivery_jobs.status`**: `pending`→`processing`(lease)→`succeeded`|`failed`.

## Invariantes

- `meta_lead_id` único ⇒ webhook (e futura recuperação 011) convergem sem duplicar.
- Uma perna por (ingestion, destination).
- `lead_delivery_jobs` só nasce quando `routing_status='resolved'`.
- `lead_raw_events`/`lead_delivery_attempts` append-only; suprimidos por dedup ficam
  `suppressed=true` + `ingestion_id` do original.
- Entrega interna DEVE carimbar o `account_id` resolvido no `contact`/`deal` (isolamento).

## Migrations planejadas (512_+)

1. `512_lead_core.sql` — `lead_ingestions`, `lead_raw_events`, `lead_rejected_events`
   (+RLS/índices).
2. `513_lead_outbox.sql` — `lead_delivery_jobs`, `lead_delivery_attempts` + habilita
   `pg_cron` (e `pg_net` se destino externo) + a função worker (SKIP LOCKED, backoff).
3. `514_routing_map.sql` — `routing_map` (RLS admin) + `account_destination_config`.
4. `515_deal_tracking.sql` — `deals.tracking JSONB` + seed dos 7 campos de rastreamento
   como `custom_fields` (por account, sob demanda).
