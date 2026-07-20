# Contratos — Recuperação Ativa + Alertas

Rotas autenticadas (SSR). Recuperação escopada pela empresa ativa; alertas central (admin).

## Recuperação ativa (FR-023..026)

### `POST /api/leads/recovery/search`
- Body: `{ form_id?, period_from, period_to }`.
- Efeito: consulta a Graph API (credenciais `meta_apps`) os leadgen do período;
  compara com `lead_ingestions.meta_lead_id`.
- Resposta: `{ found: n, items: [{ meta_lead_id, exists: bool, resumo }] }` — marca
  existentes × ausentes.

### `POST /api/leads/recovery/import`
- Body: `{ meta_lead_ids: [ ... ] }` (os ausentes escolhidos) **ou** `{ all_missing:
  true, ...mesmo filtro }`.
- Efeito: importa os ausentes via o pipeline do 009 (normaliza → roteia → entrega),
  **idempotente** por `meta_lead_id` (existentes = no-op). Registra
  `lead_recovery_runs`.
- Resposta: `{ recovered: n, skipped_existing: m, run_id }`.

## Alertas de formato (FR-031/045/046)

### `GET /api/leads/format-alerts` (admin)
- Lista `lead_format_alerts` (origem, tipo, campo, exemplo, ocorrências, first/last),
  com filtros por origem/tipo. Agrupado (não inunda).

## Geração de alertas (interno)

Sem endpoint próprio: a **normalização do 009** compara as chaves do payload contra o
conjunto esperado da origem e faz `upsert` no `lead_format_alerts` (occurrences++),
**sem interromper** a criação do lead.
