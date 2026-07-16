# Tarefas: Múltiplos números por conta

**Feature**: `007-multi-numero` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md) | **Design**: `docs/spec-multi-numero.md`

Mudança de axioma. **Pré-requisito**: a costura `resolveConfig` da spec 001.
Migrations na faixa `500_`+. Ordem: multi-app → cadastro → threads por número →
templates → broadcast/saída fria.

**Invariantes**: entrada já roteia por `phone_number_id` (não quebra) · webhook
fail-closed · threads separadas por número (índice inclui whatsapp_config_id) ·
resposta sai pelo número da conversa · secrets criptografados em `meta_apps` ·
migrations `500_`+ e divergências documentadas · i18n (feature 002).

**Legenda**: `[P]` = paralelizável.

---

## Fase 1 — Setup

- [ ] T001 Baseline verde. Confirmar que a spec 001 (engine-send-base) está
  mergeada/disponível (pré-requisito da costura). Se não, tratar como bloqueio.

---

## Fase 2 — US3: Webhook multi-app (P1) — desbloqueia o 2º App

- [ ] T002 Migration `501_meta_apps.sql`: tabela `meta_apps` (app_id, app_secret, verify_token criptografados) + `whatsapp_config.meta_app_id` FK. (FR-002)
- [ ] T003 `verifyMetaWebhookSignature` (`webhook-signature.ts`): aceitar N app_secrets (de `meta_apps`, cacheáveis) e try-all-secrets, mantendo fail-closed. (FR-005)
- [ ] T004 Webhook (`webhook/route.ts`): resolver os secrets de `meta_apps` e usar o try-all-secrets; `META_APP_ID` sai do env para `meta_apps.app_id`. (FR-005)
- [ ] T005 [P] Testes: 2 Apps → ambos autenticam; assinatura inválida → 401; nenhum secret → 401. (SC-004)

---

## Fase 3 — US1: N números por conta (P1)

- [ ] T006 Migration `502_whatsapp_config_multi.sql`: dropar `UNIQUE(account_id)`; manter `UNIQUE(phone_number_id)`. (FR-001)
- [ ] T007 [US1] Settings (`whatsapp-config.tsx`): de formulário único → **lista** de números + cadastro de Meta Apps. (FR-001, FR-002)
- [ ] T008 [P] [US1] Testes: cadastrar 2 números (mesma e WABAs diferentes) → ambos salvos/conectados. (SC-001)

---

## Fase 4 — US2: Threads por número + resposta pelo número certo (P1)

- [ ] T009 Migration `503_conversations_whatsapp_config.sql`: + `conversations.whatsapp_config_id` NOT NULL; índice dedupe `(account_id, contact_id)` → `(account_id, contact_id, whatsapp_config_id)`; migration `506_flow_runs_index.sql`: índice de run ativa inclui o número. (FR-003, FR-009 — **risco central: fusão de threads**)
- [ ] T010 [US2] Webhook: gravar `whatsapp_config_id` na conversa (do `phone_number_id` do evento); resolução de conversa considera o número (find-or-create por `(account, contact, número)`). (FR-003)
- [ ] T011 [US2] Trocar a costura `resolveConfig` (001) para `resolveConfigByConversation` (usa `conversations.whatsapp_config_id`). A resposta sai pelo número da conversa. (FR-004, FR-010)
- [ ] T012 [P] [US2] Testes: mesmo contato em 2 números → 2 threads (sem fusão); resposta sai pelo número da thread. (SC-002, SC-003)
- [ ] T013 [P] [US2] Inbox: indicar por qual número a conversa entrou (sem seletor — decisão #3). (FR-012)

---

## Fase 5 — US4: Templates por WABA (P2)

- [ ] T014 Migration `504_message_templates_waba.sql`: + `message_templates.waba_id`. (FR-006)
- [ ] T015 [US4] `templates/sync` por WABA (não uma vez por conta); seletor de template filtra pela WABA do número. (FR-006)
- [ ] T016 [P] [US4] Testes: seletor num contexto de cada número mostra só os templates da WABA correspondente. (SC-005)

---

## Fase 6 — US5/US6: Broadcast e saída fria escolhem o número (P2)

- [ ] T017 Migration `505_broadcasts_whatsapp_config.sql`: + `broadcasts.whatsapp_config_id`. (FR-007)
- [ ] T018 [US5] Broadcast wizard: novo passo "escolher número" **antes** do template; template filtrado pela WABA; disparo cai no número. (FR-007)
- [ ] T019 [US6] Saída fria (`resolve-conversation.ts` + UI da ficha/inbox): o agente escolhe o número; a thread nasce vinculada. (FR-008)
- [ ] T020 [P] Rótulos novos (número, "enviado por este número", passo do wizard, seletor) em pt/en. (FR-012)

---

## Fase 7 — Polimento & Verificação

- [ ] T021 Aplicar todas as migrations no dev; validar backfill/consistência (conversas existentes ganham `whatsapp_config_id` do número atual da conta).
- [ ] T022 Verificação end-to-end (quickstart §2, todos os 7 passos) com 2 números.
- [ ] T023 `security-review` + `code-review` na diff (foco: fail-closed do webhook, índice de fusão, isolamento — alinhar com a 006).
- [ ] T024 Documentar as divergências do upstream (webhook, whatsapp_config, índice 036) e registrar o SHA de base do upstream (Princípio V).

---

## Dependências & Ordem

- **T001** confirma a 001 (pré-requisito).
- **Fase 2 (multi-app)** primeiro — desbloqueia o 2º App.
- **Fase 3 → 4** são o núcleo (cadastro → threads por número). A Fase 4 depende
  do cadastro e da costura da 001.
- **Fases 5/6** (templates, broadcast, saída fria) depois do núcleo.
- **Fase 7** por último.

## Estratégia de entrega

- **Núcleo entregável**: Fases 2–4 (multi-app + N números + threads por número +
  resposta certa) — já permite operar 2 números de verdade.
- Fases 5/6 completam templates/broadcast/saída fria.

## Riscos

- **Índice 036** (T009): fusão silenciosa de threads se não incluir o número —
  o risco mais alto; testar explicitamente (T012).
- **Alto conflito de merge com upstream** (webhook, whatsapp_config): divergência
  deliberada, documentar (T024).
