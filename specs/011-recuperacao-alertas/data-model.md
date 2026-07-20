# Data Model — Recuperação + Alertas (Fase 1)

Aditivo sobre o 009. Migrations `517_`+.

## Entidades novas

### `lead_recovery_runs` (auditoria da recuperação — FR-026)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `account_id` | UUID FK | empresa da execução (escopo, FR-044) |
| `executed_by` | UUID FK | usuário |
| `period_from` / `period_to` | TIMESTAMPTZ | período consultado |
| `form_id` | TEXT NULL | formulário (quando aplicável) |
| `found_count` / `recovered_count` | INT | encontrados × recuperados |
| `executed_at` | TIMESTAMPTZ | |

RLS: `is_account_member(account_id)`.

### `lead_format_alerts` (mudança de formato — FR-031/045)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `source` | TEXT | `site` \| `meta_form` \| `meta_ctwa` |
| `kind` | TEXT | `unknown_field` \| `missing_field` \| `renamed_field` |
| `field` | TEXT | campo afetado |
| `example` | JSONB NULL | amostra (valor/contexto) |
| `occurrences` | INT | contador (agrupado) |
| `first_seen` / `last_seen` | TIMESTAMPTZ | |

- **Únicо** por `(source, kind, field)` — agrupa/dedup (FR-045); `occurrences++` e
  `last_seen` na repetição.
- RLS: nível de deployment (admin) por padrão (D3); leitura restrita a admin/TI.

## Reuso (009)

- **Recuperação**: importa via `lead_ingestions` + normalização/entrega do 009;
  idempotência pelo unique `meta_lead_id` (nunca duplica).
- **Alertas**: gerados **dentro** da normalização do 009 (comparação de chaves), sem
  interromper; bruto já preservado (`lead_raw_events`, FR-004).

## Migrations planejadas (517_+)

1. `517_lead_recovery_runs.sql` — auditoria da recuperação (+RLS).
2. `518_lead_format_alerts.sql` — alertas agrupados (+índice único source+kind+field).
