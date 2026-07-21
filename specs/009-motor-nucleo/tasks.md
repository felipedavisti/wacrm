# Tasks: Motor de Leads — Núcleo

**Input**: Design de `specs/009-motor-nucleo/` (spec, plan, research, data-model, contracts, quickstart)

**Depende de**: 008-multi-conta aplicada (empresa = account; RLS). Migrations `512_`+.

**Invariantes**: nunca descartar (raw antes de tudo) · idempotência Meta por `meta_lead_id` ·
dedup Site 24h · ingestão fail-closed (FR-037) · entrega carimba o account resolvido
(isolamento) · destino plugável por conta · painel por empresa ativa; roteamento central
(admin) · divergências upstream documentadas (Princípio V) · superfícies sensíveis
revisadas (Princípio II) · i18n pt-BR/en.

**Legenda**: `[P]` = paralelizável.

---

## Phase 1: Setup

- [x] T001 Baseline: 008 mergeada na `main` e aplicada no dev (508–512); build/tsc/suíte ✅. **Faixa da 009 = `513_`+** (a `512_` foi o hotfix de escopo da 008). **`pg_cron`/`pg_net` NÃO são necessários**: o worker é endpoint da app (cron externo) e faz a entrega em Node — só o CLAIM atômico vive no banco (RPC com SKIP LOCKED). Menos dependência e funciona em qualquer tier.
- [ ] T002 [P] Criar namespaces i18n dos rótulos do motor (painel, detalhe, reprocessar, roteamento, destino) em `messages/pt-BR.json`/`en.json` (placeholders).

---

## Phase 2: Foundational (Blocking) — o espinhaço do motor

**⚠️ CRITICAL**: nenhuma US começa antes disto.

- [x] T003 Migration **`513_lead_core.sql`**: `lead_ingestions` (ledger, com `target_pipeline_id/stage_id` e ponteiros `contact_id/deal_id`), `lead_raw_events` (append-only, com `suppressed`), `lead_rejected_events`. RLS com **`is_active_member`** (lição da 512); leitura apenas — escrita é service_role/RPC (deny-by-default). Leads sem empresa ficam invisíveis ao cliente (superfície central). Índices: unique `meta_lead_id`, dedup, painel, fila de não-roteados. (FR-004, FR-008..010, FR-018)
- [ ] T004 Migration `514_routing_map.sql`: `routing_map` (`match_kind` filial|campaign, `match_value`, RLS admin/TI) + `account_destination_config`; e `src/lib/leads/routing.ts` que resolve empresa (+ funil/estágio) por **filial (Site)** ou **campanha (Meta)**. (FR-011, FR-012, FR-015)
- [x] T005 [P] Migration **`516_deal_tracking.sql`**: `deals.tracking JSONB` (+índice GIN) com o mapeamento `ink_new_*` documentado. Decisão: JSONB no deal em vez de linhas de custom-field (B4) — mantém a mudança aditiva sobre a tabela do upstream e absorve campos de origens futuras sem migration. (FR-005)
- [ ] T006 `src/lib/leads/deliver-internal.ts`: cria/atualiza `contact` (dedup no account) + cria `deal` no funil-alvo (ou de entrada padrão) com `contact_id` e `tracking`. Carimba o account resolvido. (FR-014)
- [ ] T007 Migration `513_lead_outbox.sql`: `lead_delivery_jobs` + `lead_delivery_attempts` + o **worker** (reivindica jobs `FOR UPDATE SKIP LOCKED`, backoff exponencial, 5 tentativas, lease/reclaim). Agendamento: endpoint `POST /api/leads/worker/tick` chamado por **cron externo** (Vercel Cron) — padrão robusto em qualquer tier; `pg_cron`/`pg_net` como alternativa quando o projeto não pausa (B5). (FR-016, FR-034, FR-036)
- [x] T008 [P] `canonical.ts` (modelo único + helpers de telefone/produto), `normalize.ts` (Site e Meta Form → canônico) e `dedup.ts` (Site: **cpf** senão tel+email, + produto, janela 24h; Meta: form_id+contato, sem janela). Funções **puras**. **20 testes verdes** com os payloads REAIS de produção (site + webhook leadgen + enriquecimento Graph), incluindo: 7 campos de rastreamento, perguntas do form preservadas (nomes mudam entre versões), lead criado mesmo sem enriquecimento. (FR-008, FR-017..020)
- [ ] T009 [P] Tipos TS das entidades do motor em `src/types/index.ts`.
- [ ] T010 [P] Teste de integração do worker: SKIP LOCKED, backoff, 5 tentativas, sem reenvio duplo simultâneo. (SC-003)

**Checkpoint**: espinhaço pronto — ingestão pode ser plugada.

---

## Phase 3: User Story 2 — Lead do site vira deal (Priority: P1) 🎯 MVP

**Independent Test**: POST site (token válido) → 1 deal no funil; reenvio 24h não duplica.

- [ ] T011 [US2] `POST /api/leads/ingest/site` em `src/app/api/leads/ingest/site/route.ts`: valida token (fail-closed → `lead_rejected_events`); grava raw; normaliza; dedup 24h; roteia; enfileira ou `pending`. (FR-001, FR-017, FR-037)
- [ ] T012 [US2] Teste: token inválido → 401 + rejeitado; envio válido → 1 lead → (após worker) 1 contact + 1 deal; duplicado 24h → suprimido vinculado. (SC-008)

**Checkpoint**: origem Site ponta a ponta (MVP).

---

## Phase 4: User Story 1 — Lead de Meta Form com rastreamento (Priority: P1)

**Independent Test**: leadgen assinado → deal com 7 campos de rastreamento; reentrega não duplica.

- [ ] T013 [US1] `GET`+`POST /api/leads/ingest/meta`: `GET` verify token; `POST` valida `X-Hub-Signature-256` (007/`meta_apps`), grava raw (só IDs). **Enriquecimento via Graph API** (`src/lib/leads/meta-enrich.ts`, token `meta_apps`): `GET /{ad_id}` + `GET /{leadgen_id}?fields=field_data,…` + `GET /{form_id}` → contato + 7 campos de rastreamento. Idempotência por `meta_lead_id`; dedup form_id+phone+email; roteia por **`form_id`→empresa**; enfileira. O enriquecimento roda no processamento assíncrono (retry se a Graph falhar). (FR-001, FR-005, FR-018, FR-019, FR-037)
- [ ] T014 [US1] Teste: assinatura inválida → 401 + rejeitado; leadgen válido → deal com rastreamento completo; mesmo `meta_lead_id` reentregue → não duplica. (SC-002, SC-008)

**Checkpoint**: origem Meta Form ponta a ponta.

---

## Phase 5: User Story 3 — Reprocessamento visual (Priority: P1)

**Independent Test**: forçar falhas, filtrar "Somente falhas", "Selecionar todas as N", reenviar em lote → todos `sent`.

- [ ] T015 [US3] `GET /api/leads` (lista, filtros origem/status/período, empresa ativa) + `GET /api/leads/[id]` (bruto + tentativas + suprimidos). (FR-027, FR-029)
- [ ] T016 [US3] `POST /api/leads/reprocess` (ids **ou** filtro+all) reagenda jobs; **lock** impede reenvio duplo simultâneo. (FR-028)
- [ ] T017 [US3] UI do painel em `src/components/leads/` (lista com filtros, detalhe com bruto/erros, ações reenviar individual e em lote "todas as N do filtro").
- [ ] T018 [US3] Teste: seleção "todas as N do filtro" cobre além da página; reprocessar 2x o mesmo lead é bloqueado. (SC-003, SC-004)

**Checkpoint**: o coração (falha visível e recuperável) funciona.

---

## Phase 6: User Story 4 — Roteamento gerenciável + fila de não-roteados (Priority: P1)

**Independent Test**: cadastrar regra → lead roteia; lead sem regra → fila central; cadastrar regra → reprocessa e some da fila.

- [ ] T019 [US4] Superfície central de `routing_map` (CRUD) em `src/components/admin/routing/` — acesso admin/TI; criar/editar/desativar regras campanha→empresa(+funil/estágio). (FR-011, FR-012, FR-015)
- [ ] T020 [US4] Fila de **não-roteados** (`routing_status='pending'`): listar; ao cadastrar/editar regra, **reprocessar** os pendentes que passam a casar e roteá-los. (FR-022, SC-007)
- [ ] T021 [P] [US4] Teste: campanha sem de-para → `pending` (fora do painel de conta); após a regra → roteado e enfileirado. (SC-007)

**Checkpoint**: nenhum lead perdido por falta de mapeamento.

---

## Phase 7: User Story 5 — Destino configurável por conta (Priority: P2)

**Independent Test**: destino interno cria deal; trocar para externo (stub) → entrega vai ao externo pelo mesmo outbox.

- [ ] T022 [US5] `GET/PUT /api/account/lead-destination` + UI de config por empresa (interno|externo, segredos criptografados). (FR-036)
- [ ] T023 [US5] Adaptador de destino **externo** (via pg_net/Edge Function) plugado no worker; sem alterar ingestão/normalização/persistência. (FR-036, SC-011)
- [ ] T024 [P] [US5] Teste: troca interno↔externo vale para os próximos leads; núcleo inalterado; `partially_sent` surge só com >1 destino. (SC-011, FR-034)

**Checkpoint**: dupla função (motor puro vs motor+CRM) por conta.

---

## Phase 8: User Story 6 — Painel de indicadores (Priority: P2)

**Independent Test**: popular leads de várias origens/status → totalizadores e filtros corretos, ≤ 30s.

- [ ] T025 [US6] `GET /api/leads/metrics` (total do dia, por origem, falhas e %, empresa ativa) + widgets no painel; atualização por consulta periódica (≤ 30s). (FR-030, SC-006)
- [ ] T026 [P] [US6] Teste: totalizadores respeitam filtros combinados e o escopo da empresa ativa. (SC-006)

**Checkpoint**: visibilidade contínua.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T027 [P] Rótulos i18n do motor completos (pt-BR/en) + teste de paridade/ICU.
- [ ] T028 **Revisão de segurança** (Princípio II): `/security-review` — ingestão fail-closed, worker/entrega interna carimbando o account certo, segredos de destino externo, RLS das tabelas novas + `routing_map`.
- [ ] T029 Documentar divergências do upstream (tabelas/rotas novas, `deals.tracking`) nas migrations 512–515 e no runbook de sync. (Princípio V)
- [ ] T030 Implementar a **superfície central** (routing_map + fila de não-roteados) como tela de admin/TI — **decisão B1=A tomada** (não usar "account de staging"). Garantir acesso restrito a admin/TI.
- [ ] T031 Rodar a validação do `quickstart.md` (5 cenários) e `/code-review` da diff da 009.

---

## FR-047 — Template de boas-vindas do lead de formulário (opcional)

- [ ] T032 Opção **por conta** (padrão **OFF**) "enviar template de boas-vindas ao criar um lead de formulário Meta" + a ação de envio: ao criar o lead (US1), se a conta tiver a opção ligada, disparar um **template** (reusa o envio de templates da **007**, respeita a janela de 24h da **005**) para iniciar a conversa e engajar o lead. Desligada → nenhum envio. A condução por IA da conversa fica nas **automações futuras (012)**. (FR-047)

---

## Dependencies & Execution Order

- **Foundational (Phase 2)** bloqueia tudo. Ordem: T003 → T004/T005 → T006 → T007 (worker usa T006); T008/T009/T010 [P].
- **US2 (P1, MVP)** e **US1 (P1)** dependem da Foundational; podem correr em paralelo (endpoints distintos).
- **US3 (P1)** depende de haver leads/jobs (US1/US2) para reprocessar.
- **US4 (P1)** depende do `routing_map` (T004); a fila de não-roteados fecha o "nunca perder".
- **US5/US6 (P2)** dependem da Foundational + painel (US3).
- **Polish** por último (T028/T030/T031).

### MVP sugerido

Setup + Foundational + **US2** (site → deal) + **US3** (reprocessamento) — já entrega
o valor central: ingestão que vira negócio no funil, com falha visível e recuperável.
Depois US1 (Meta), US4 (roteamento/fila), US5 (destino), US6 (painel).

### Paralelismo

T005/T008/T009/T010 [P] na Foundational; US1 e US2 em paralelo; T021/T024/T026/T027 [P].

---

## Notes

- Testes incluídos (idempotência, dedup, fail-closed, worker, isolamento) — a
  sensibilidade de segurança e o "nunca descartar" exigem cobertura.
- Obrigações constitucionais como tarefas: T028 (segurança, Princípio II), T029
  (divergências upstream, Princípio V). T030 valida a decisão de escopo D4 com o PO.
