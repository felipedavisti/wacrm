# Tarefas: Janela de 24h proativa

**Feature**: `005-janela-24h` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md)

Inclui **uma migration** (faixa `500_`). Abordagem test-first no helper e no core.

**Invariantes**: janela derivada de `last_inbound_at` (UTC) · texto livre fora da
janela recusado ANTES da Meta · template sempre permitido · 131047 mapeado ·
migration na faixa 500_ · rótulos via i18n (feature 002).

**Fora de escopo**: contador regressivo; auto-envio de template ao expirar.

**Legenda**: `[P]` = paralelizável.

---

## Progresso (2026-07-18)

Feature completa no código. Suíte 702/702, typecheck limpo.

- **Fundacional (T002–T004)** ✅ migration `500_` (primeira do fork); webhook seta
  `last_inbound_at` (timestamp da própria msg do cliente, consistente com o backfill);
  helper `window.ts` (`isWindowOpen`, `latestInboundAnchor`) testado.
- **US1 (T005–T007)** ✅ `send-message`: não-template fora da janela → `window_expired`
  ANTES da Meta; template sempre passa; 131047 mapeado. Testes cobrem os 4 casos.
- **US2 (T008–T010)** ✅ o composer **já** tratava a janela (`sessionExpired`) — reusado
  sem duplicar. Alinhei o `sessionInfo` ao `last_inbound_at` (mesma fonte do backend),
  ancorando no MAIS RECENTE entre a coluna e a última msg carregada (reabertura, SC-004),
  e o `expired` reusa `isWindowOpen`. i18n já existia (sem chaves novas).
- **T013** ✅ `/code-review` (high): nenhum bug de lógica; 1 achado **operacional** —
  o código **depende da migration 500_ estar aplicada** (senão o webhook falha e todo
  envio não-template é recusado). Mitigação = disciplina de migration (T011).

**Pendente (🧪 — precisa do ambiente):**
- **T011** — **aplicar a migration `500_`** no Supabase de dev (e em prod no deploy).
  É aditiva (só adiciona a coluna) e segura de aplicar a qualquer momento. **Pré-requisito**
  para rodar este código.
- **T012** — e2e ao vivo (dentro/fora da janela, template, reabertura) — depende da
  migration aplicada + uma conversa com mensagem de cliente.

---

## Fase 1 — Setup

- [x] T001 Baseline: `npm run test` e `npm run typecheck` verdes.

---

## Fase 2 — Fundacional: rastreio + helper (bloqueia US1/US2)

- [x] T002 Criar a migration `supabase/migrations/500_conversations_last_inbound_at.sql`: adicionar `conversations.last_inbound_at TIMESTAMPTZ` + backfill a partir da última mensagem de cliente (conforme data-model.md). Idempotente. (FR-001)
- [x] T003 No webhook (`src/app/api/whatsapp/webhook/route.ts`), ao gravar uma mensagem de `sender_type='customer'`, atualizar `conversations.last_inbound_at = now()` (junto do `last_message_at`). (FR-002)
- [x] T004 [P] Criar helper `isWindowOpen(last_inbound_at)` (ex.: `src/lib/whatsapp/window.ts`) + testes: <24h aberta, >24h fechada, null fechada (UTC). (FR-003, FR-008)

---

## Fase 3 — US1: O sistema respeita a janela (P1) 🎯 MVP

- [x] T005 [US1] Em `src/lib/whatsapp/send-message.ts`, para envios não-template, checar `isWindowOpen`; se fechada, lançar `SendMessageError('window_expired', ...)` **antes** de chamar a Meta. Templates passam sempre. (FR-004, FR-005)
- [x] T006 [US1] Mapear o erro **131047** da Meta para a mesma `window_expired` (backstop de corrida) no tratamento de erro de envio. (FR-006)
- [x] T007 [P] [US1] Testes em `send-message.test.ts`: não-template fora da janela → `window_expired` sem chamar Meta; template fora da janela → passa; 131047 → mapeado. (SC-001, SC-002)

---

## Fase 4 — US2: A inbox avisa proativamente (P1)

- [x] T008 [US2] Passar o estado da janela (derivado de `last_inbound_at` já na conversa carregada) ao `src/components/inbox/message-composer.tsx`; quando fechada, sinalizar e oferecer o seletor de template em vez de texto livre. (FR-007)
- [x] T009 [US2] Garantir que a chegada de mensagem do cliente (real-time existente) reabre a janela na UI sem recarregar. (SC-004)
- [x] T010 [P] [US2] Rótulos/mensagens ("Janela de 24h expirada", "Envie um template para reabrir", etc.) em `en.json` e `pt.json`, com paridade. (FR-009)

---

## Fase 5 — Polimento & Verificação

- [ ] T011 Aplicar a migration no dev e validar o backfill (conversas com entrada recente ficam abertas; sem entrada, fechadas). **🧪 pendente — precisa do ambiente.**
- [ ] T012 Verificação end-to-end (quickstart §2): dentro/fora da janela, template, reabertura. **🧪 pendente — depende de T011.**
- [x] T013 `code-review` na diff (foco: sem regressão no envio da 001; janela calculada em UTC; template nunca bloqueado).

---

## Dependências & Ordem

- T001 → **T002/T003/T004** (fundacional) → US1 (T005→T006, T007 `[P]`) → US2 (T008→T009, T010 `[P]`) → Fase 5.
- T004 e T007 e T010 são `[P]` (arquivos distintos).

## Estratégia de entrega

- **MVP = Fundacional + US1** (T001–T007): o sistema para de mandar texto fora da
  janela e orienta — o valor central. US2 adiciona o aviso proativo.

## Paralelismo

- T004 (helper) ∥ T002/T003.
- T007 (testes core) ∥ implementação; T010 (i18n) ∥ T008/T009.
