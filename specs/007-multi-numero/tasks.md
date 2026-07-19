# Tarefas: Múltiplos números por conta

**Feature**: `007-multi-numero` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md) | **Design**: `docs/spec-multi-numero.md`

Mudança de axioma. **Pré-requisito**: a costura `resolveConfig` da spec 001.
Migrations na faixa `500_`+. Ordem: multi-app → cadastro → threads por número →
templates → broadcast/saída fria.

**Invariantes**: entrada já roteia por `phone_number_id` (não quebra) · webhook
fail-closed · threads separadas por número (índice inclui whatsapp_config_id) ·
resposta sai pelo número da conversa · secrets criptografados em `meta_apps` ·
migrations `500_`+ e divergências documentadas · i18n (feature 002).

**Legenda**: `[P]` = paralelizável. `[x]` = feito · `[~]` = parcial/divergente (ver nota) · `[ ]` = pendente.

> **Status (2026-07-19):** núcleo (Fases 1–4) **completo e testado**. Fases 5–6
> entregues com 2 divergências de escopo (T015 sync-por-WABA, T018 UX do wizard).
> Fase 7: migrations aplicadas; e2e validado **visualmente** (número dev — os test
> numbers da Meta colidem, sem 2 números reais); review formal pendente. Detalhes
> nas notas de cada task.

---

## Fase 1 — Setup

- [x] T001 Baseline verde. Spec 001 (engine-send-base) mergeada; costura `resolveConfig` disponível.

---

## Fase 2 — US3: Webhook multi-app (P1) — desbloqueia o 2º App

- [x] T002 Migration `501_meta_apps.sql`: tabela `meta_apps` + `whatsapp_config.meta_app_id` FK. (FR-002)
- [x] T003 `webhook-auth.ts` `loadWebhookAppSecrets`: N app_secrets (de `meta_apps` + env fallback), try-all-secrets, fail-closed. (FR-005)
- [x] T004 Webhook (`webhook/route.ts`): resolve os secrets de `meta_apps` e usa try-all-secrets. UI de cadastro do App Secret (Settings → seção Meta App → grava em `meta_apps`, linka `meta_app_id`) adicionada no Estágio C. (FR-005)
- [x] T005 [P] Testes: `webhook-auth.test.ts` + `webhook-signature.test.ts` (múltiplos secrets, assinatura inválida → 401, sem secret → 401). (SC-004)

---

## Fase 3 — US1: N números por conta (P1)

- [x] T006 Migration `502_whatsapp_config_multi_number.sql`: dropa `UNIQUE(account_id)`; mantém `UNIQUE(phone_number_id)`. (FR-001)
- [x] T007 [US1] Settings (`whatsapp-config.tsx`): formulário único → **lista** "Números conectados" (editar/add/remover) + apelido + seção Meta App. (FR-001, FR-002)
- [~] T008 [P] [US1] Testes: **feature validada visualmente** (número dev), mas **sem teste automatizado** da rota `config` (não há `config/route.test.ts`). Dívida de teste. (SC-001)

---

## Fase 4 — US2: Threads por número + resposta pelo número certo (P1)

- [x] T009 Migrations `503_conversations_per_number.sql` (+ `conversations.whatsapp_config_id`, índice dedupe inclui o número) e `506_flow_runs_per_number.sql`. (FR-003, FR-009)
- [x] T010 [US2] Webhook grava `whatsapp_config_id` (do `phone_number_id` do evento); `resolve-conversation.ts` faz find-or-create por `(account, contact, número)`. Saída fria (send route) também carimba o número. (FR-003)
- [x] T011 [US2] Costura trocada para `resolveConfigByConversation` (lê `conversations.whatsapp_config_id`); resposta sai pelo número da conversa. (FR-004, FR-010)
- [x] T012 [P] [US2] Testes: `resolve-conversation.test.ts` + `engine-send-base.test.ts` (por-conversa + fallback). (SC-002, SC-003)
- [x] T013 [P] [US2] Inbox: badge do número por thread (só com ≥2 números). (FR-012)

---

## Fase 5 — US4: Templates por WABA (P2)

- [x] T014 Migration `504_message_templates_waba.sql`: + `message_templates.waba_id` (+ campo no tipo TS). (FR-006)
- [~] T015 [US4] Seletor **filtra por WABA** no `TemplatePicker` (saída fria); Modelos mostram badge do número; Disparos agrupam por número. **Falta:** `templates/sync` ainda é por conta (1º número, `.limit(1)`), não itera por WABA — refinamento. (FR-006)
- [~] T016 [P] [US4] **Validado visualmente** (número dev: `hello_world`@WABA-real vs `suporte_demo`@WABA-dev). Sem teste automatizado do filtro (componente client). (SC-005)

---

## Fase 6 — US5/US6: Broadcast e saída fria escolhem o número (P2)

- [x] T017 Migration `505_broadcasts_whatsapp_config.sql`: + `broadcasts.whatsapp_config_id`. (FR-007)
- [~] T018 [US5] Broadcast: seletor "Enviar pelo número" no **passo 4** (não antes do template); templates **agrupados** por WABA no passo 1 (não pré-filtrados por número escolhido); disparo cai no número escolhido; rota `.single()`→`.limit(1)`. **Divergência de UX** deliberada (número depois do template). (FR-007)
- [x] T019 [US6] Saída fria: `TemplatePicker` com seletor "Enviar pelo número" (só ≥2); send route valida o `whatsapp_config_id` (escopo da conta) e a thread nasce vinculada. (FR-008)
- [x] T020 [P] Rótulos novos (apelido, "enviar pelo número", App Secret, agrupamento) em pt-BR/en; teste de paridade + validade ICU como portão. (FR-012)

---

## Fase 7 — Polimento & Verificação

- [x] T021 Migrations 501–507 aplicadas no dev; conversas com `whatsapp_config_id`.
- [~] T022 E2E: validado **visualmente** com número **dev** (lista/seletores/badge/filtro/agrupamento). Envio+recebimento real nos 2 **não** foi possível: a Meta reusa o mesmo test number entre Apps → sem 2 números reais distintos. Precisa de número REAL na WABA para o e2e completo.
- [ ] T023 `security-review` + `code-review` formais na diff do 007 — **pendente** (só a suíte 719 + tsc/lint rodaram).
- [~] T024 Divergências comentadas nas migrations 501–507 e no [[upstream-sync-runbook]]; **falta** registrar o SHA base do upstream formalmente.

---

## Extra (fora do plano original, feito na entrega)

- [x] Hardening: todos os `.single()`/`.maybeSingle()` por conta em `whatsapp_config` que estouravam PGRST116 com ≥2 números → `.limit(1)` (inbox banner, react, media, verify-registration, engine byAccount, broadcast-core, templates sync/submit/[id]).
- [x] i18n: correção de `INVALID_TAG`/`MALFORMED_ARGUMENT` (mensagens com `<strong class>` e `{{1}}`/JSON) + teste de validade ICU de todas as mensagens.

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
