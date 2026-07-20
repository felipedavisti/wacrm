# Tasks: Motor de Leads — CTWA

**Input**: Design de `specs/010-ctwa/` (spec, plan, research, data-model, contracts, quickstart)

**Depende de**: 007 (webhook/inbox WhatsApp), 008 (empresa=account), 009 (ledger, deliver-internal, outbox). Migrations `516_`+.

**Invariantes**: fail-closed reusa 007 · empresa = account da conversa (sem de-para) ·
criação automática e **idempotente por conversa** · referral parcial → pendência de
atribuição, nunca descarte · isolamento por account · divergência no `webhook/route.ts`
documentada (Princípio V) · superfícies sensíveis revisadas (Princípio II) · i18n.

**Legenda**: `[P]` = paralelizável.

---

## Phase 1: Setup

- [ ] T001 Confirmar baseline (007/008/009 aplicadas; `tsc`/lint verdes); fixar `516_`.
- [ ] T002 [P] Namespaces i18n (badge CTWA, "pendência de atribuição") em `messages/pt-BR.json`/`en.json`.

---

## Phase 2: Foundational (Blocking)

- [ ] T003 Migration `516_ctwa_referrals.sql`: tabela `ctwa_referrals` (wamid PK, conversation_id, account_id, campos de campanha, raw, lead_ingestion_id, captured_at) +RLS por account + índice `(conversation_id)`. (FR-038, FR-042)
- [ ] T004 [P] Tipos TS de `ctwa_referrals` em `src/types/index.ts`.

**Checkpoint**: base para captura pronta.

---

## Phase 3: User Story 1 — Captura passiva do referral (Priority: P1)

**Independent Test**: 1ª mensagem CTWA com referral → `ctwa_referrals` gravado; sem referral → nada.

- [ ] T005 [US1] `src/lib/whatsapp/ctwa-referral.ts`: parse do objeto `referral` da mensagem + persistência em `ctwa_referrals` (account = da conversa; raw preservado). (FR-038, FR-042)
- [ ] T006 [US1] Estender `src/app/api/whatsapp/webhook/route.ts`: no processamento da mensagem, se houver `referral`, chamar a captura (passo isolado, sem afrouxar a assinatura/fail-closed do 007). (FR-038)
- [ ] T007 [US1] Teste: mensagem com referral → vínculo gravado; sem referral → ignorada; assinatura inválida → nada capturado (reusa 007). (SC-CTWA-1)

**Checkpoint**: atribuição capturada, sem perder anúncio.

---

## Phase 4: User Story 2 — Lead criado automaticamente e imediato (Priority: P1)

**Independent Test**: referral capturado → deal no funil na hora, idempotente por conversa.

- [ ] T008 [US2] `src/lib/leads/create-from-ctwa.ts`: cria `lead_ingestions` (`source='meta_ctwa'`, account da conversa, 6 campos de rastreamento) e enfileira a entrega (009) que cria o `deal` no funil de entrada, vinculado ao contato/conversa existentes. **Idempotente por `conversation_id`** (marca `ctwa_referrals.lead_ingestion_id`). (FR-039, FR-040, FR-041)
- [ ] T009 [US2] Ligar a captura (T006) ao gatilho de criação: ao gravar um referral novo de uma conversa sem lead CTWA, disparar `create-from-ctwa`. (FR-039)
- [ ] T010 [US2] Teste: referral → 1 deal com os 6 campos; novas mensagens/reentrega → não duplica; empresa = account da conversa. (SC-CTWA-2, SC-CTWA-4)

**Checkpoint**: CTWA vira oportunidade rastreável no ato.

---

## Phase 5: User Story 3 — Referral incompleto não bloqueia (Priority: P2)

**Independent Test**: referral parcial → deal criado com pendência de atribuição; dado tardio completa.

- [ ] T011 [US3] Tratar referral parcial em `create-from-ctwa`: cria com o disponível + marca **pendência de atribuição**; captura tardia de campos **completa** o vínculo/lead. (FR-007)
- [ ] T012 [P] [US3] Teste: parcial → deal + pendência sinalizada; campo tardio → atribuição completada. (SC-CTWA-3)

**Checkpoint**: nunca perder, mesmo com referral incompleto.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T013 [P] Badge/indicador de origem CTWA e de "pendência de atribuição" na inbox/painel; rótulos i18n (paridade pt-BR/en).
- [ ] T014 **Revisão de segurança** (Princípio II): `/security-review` do passo CTWA no webhook (fail-closed intacto) e da criação automática (carimba o account certo; RLS de `ctwa_referrals`).
- [ ] T015 Documentar a divergência no `webhook/route.ts` (passo CTWA) na migration 516 e no runbook de sync. (Princípio V)
- [ ] T016 Rodar `quickstart.md` (4 cenários) e `/code-review` da diff da 010.

---

## Dependencies & Execution Order

- Foundational (T003/T004) bloqueia. US1 (captura) antes de US2 (criação usa o referral).
  US3 refina US2. Polish por último.
- **MVP** = Setup + Foundational + US1 + US2 (captura + criação imediata). US3 (parcial)
  e Polish em seguida.

### Paralelismo

T004 [P]; T012/T013 [P].

## Notes

- Reuso máximo: 007 (webhook) + 009 (ledger/deal/outbox). Só a captura e o gatilho são
  novos. Qualificação/atribuição por IA = automação futura (FR-043), fora da 010.
- Obrigações constitucionais: T014 (segurança, II), T015 (divergência webhook, V).
