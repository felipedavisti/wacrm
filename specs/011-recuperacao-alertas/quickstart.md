# Quickstart — Recuperação Ativa + Alertas

Requer **009** (ledger, idempotência `meta_lead_id`, entrega) e **008**. Migrations `517_`+.
Credenciais Meta (Graph API leads) via `meta_apps` (007).

## Cenário 1 — Recuperação ativa (US1)

1. Gerar leads de teste na Meta com o webhook desativado (simular janela).
2. `POST /api/leads/recovery/search` com o período → lista existentes × ausentes.
3. `POST /api/leads/recovery/import` dos ausentes → criados via 009; rodar de novo →
   nenhum duplicado (idempotência `meta_lead_id`). `lead_recovery_runs` registra a
   execução (executor, período, encontrados/recuperados).

## Cenário 2 — Alerta de formato (US2)

- Enviar (ingestão 009) um payload com **campo novo** → o lead é criado normalmente,
  bruto preservado, e um `lead_format_alerts(unknown_field)` é registrado.
- Repetir com o mesmo campo → o alerta **agrupa** (occurrences++), não cria vários.
- Enviar sem um campo esperado → alerta `missing_field`.
- `GET /api/leads/format-alerts` → lista agrupada.

## Testes esperados

- Recuperação idempotente (por `meta_lead_id`); auditoria registrada; escopo por
  empresa ativa.
- Alertas nunca interrompem o processamento; bruto preservado; agrupados.
