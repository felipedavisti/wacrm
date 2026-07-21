# Tasks: Motor de Leads — Recuperação Ativa + Alertas de Formato

**Input**: Design de `specs/011-recuperacao-alertas/` (spec, plan, research, data-model, contracts, quickstart)

**Depende de**: 009 (ledger, idempotência `meta_lead_id`, normalização/entrega), 008 (empresa=account), 007 (`meta_apps`/Graph). Migrations `517_`+.

**Invariantes**: recuperação idempotente por `meta_lead_id` · alertas nunca interrompem
o processamento · bruto sempre preservado · escopo por account · credenciais Meta
server-only · divergências documentadas (Princípio V) · superfícies sensíveis revisadas
(Princípio II) · i18n.

**Legenda**: `[P]` = paralelizável.

---

## Phase 1: Setup

- [ ] T001 Confirmar baseline (008/009 aplicadas; `tsc`/lint verdes); fixar `517_`.
- [ ] T002 [P] Namespaces i18n (recuperação, alertas) em `messages/pt-BR.json`/`en.json`.

---

## Phase 2: Foundational (Blocking)

- [ ] T003 Migration `517_lead_recovery_runs.sql`: auditoria da recuperação (+RLS por account). (FR-026)
- [ ] T004 [P] Migration `518_lead_format_alerts.sql`: alertas agrupados (único `source+kind+field`) (+RLS admin). (FR-031, FR-045)
- [ ] T005 [P] Tipos TS das duas tabelas em `src/types/index.ts`.

**Checkpoint**: base pronta.

---

## Phase 3: User Story 1 — Recuperação ativa na Meta (Priority: P1) 🎯

**Independent Test**: gerar leads na Meta com webhook off; buscar período; importar ausentes; repetir → sem duplicar.

- [ ] T006 [US1] `src/lib/leads/meta-recovery.ts`: pull dos leadgen na Graph API (credenciais `meta_apps`, server-only) por período/`form_id`; diff contra `lead_ingestions.meta_lead_id`. (FR-023, FR-024)
- [ ] T007 [US1] `POST /api/leads/recovery/search` (retorna existentes × ausentes) e `POST /api/leads/recovery/import` (importa ausentes via pipeline 009, idempotente; grava `lead_recovery_runs`). (FR-024, FR-025, FR-026, FR-044)
- [ ] T008 [US1] UI de recuperação em `src/components/leads/recovery/` (buscar período, ver existentes×ausentes, importar, ver auditoria).
- [ ] T009 [US1] Teste: importação idempotente (`meta_lead_id`); só ausentes criados; auditoria registrada; escopo por empresa ativa. (SC-009, SC-RA-1)

**Checkpoint**: leads que nem entraram no motor são recuperáveis.

---

## Phase 4: User Story 2 — Alertas de mudança de formato (Priority: P2)

**Independent Test**: payload com campo novo → lead criado normal + alerta; repetição agrupa.

- [ ] T010 [US2] `src/lib/leads/format-detect.ts`: compara chaves do payload vs conjunto esperado da origem → `upsert` em `lead_format_alerts` (occurrences++, exemplo, first/last). (FR-031, FR-045)
- [ ] T011 [US2] Estender `src/lib/leads/normalize.ts` (009) para chamar `format-detect` **sem interromper** a criação do lead nem alterar o fluxo. (FR-031)
- [ ] T012 [US2] `GET /api/leads/format-alerts` + tela em `src/components/admin/format-alerts/` (origem, tipo, campo, exemplo, ocorrências). (FR-046)
- [ ] T013 [P] [US2] Teste: campo novo → lead criado + alerta; repetição agrupa; campo ausente → `missing_field`; nunca interrompe. (SC-FMT-1, SC-FMT-2)

**Checkpoint**: degradação silenciosa vira alerta visível.

---

## Phase 5: Polish & Cross-Cutting

- [ ] T014 [P] Rótulos i18n (recuperação/alertas) + paridade pt-BR/en.
- [ ] T015 **Revisão de segurança** (Princípio II): `/security-review` — credenciais Meta server-only no pull; importação carimba o account certo; RLS das tabelas novas.
- [ ] T016 Documentar divergências do upstream (tabelas/rotas novas + hook na normalização) nas migrations 517–518 e no runbook. (Princípio V)
- [ ] T017 Rodar `quickstart.md` (2 cenários) e `/code-review` da diff da 011.

---

## Dependencies & Execution Order

- Foundational (T003–T005) bloqueia. US1 e US2 são independentes (podem correr em
  paralelo). Polish por último.
- **MVP** = Setup + Foundational + **US1** (recuperação — a rede de segurança de maior
  valor). US2 (alertas) em seguida.

### Paralelismo

T004/T005 [P]; US1 e US2 em paralelo; T013/T014 [P].

## Notes

- Reuso do 009 (idempotência/entrega/normalização). Recuperação só Meta Form.
- Obrigações constitucionais: T015 (segurança, II), T016 (divergências, V).
