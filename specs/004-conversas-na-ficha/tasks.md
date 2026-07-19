# Tarefas: Conversas na ficha do contato

**Feature**: `004-conversas-na-ficha` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md)

Feature de UI pequena, **sem migration**. Reusa os helpers da inbox.

**Invariantes**: account-scoped · deep link `/inbox?c=<id>` · lista suporta N
(multi-número) · estado vazio sem erro · rótulos via i18n (feature 002).

**Fora de escopo**: iniciar conversa a partir da ficha (saída fria — multi-número);
paginação avançada.

**Legenda**: `[P]` = paralelizável.

---

## Progresso (2026-07-18)

Feature completa no código. Suíte 704/704, typecheck limpo. Colisão upstream
(`292f52f`) já estava mergeada na `main` — construído sobre o estado atual, sem
conflito vivo.

- **T002–T005** ✅ aba "Conversas" em `contact-detail-view.tsx`: query por
  `contact_id` (RLS, client do browser) reusando `CONVERSATION_SELECT`/
  `normalizeConversations`, ordenada por `last_message_at` desc; item com
  status/prévia/data/não-lidas linkando `/inbox?c=<id>`; estado vazio; lista N.
- **T006** ✅ i18n `tabs.conversations` + `conversationsTab.*` em en.json e
  pt.json (paridade mantida — teste verde).
- **T009** ✅ `/code-review` focado: sem bugs; isolamento por RLS confirmado;
  cast `as never` removido (limpeza).

**Pendente (🧪 — precisa de dados):**
- **T007/T008** — verificação visual: ficha com conversa mostra e linka; sem
  conversa mostra vazio; 2 conversas aparecem ordenadas. Depende de conversas no
  banco (dev tem 0 hoje — precisa de inbox conectada ou seed).

---

## Fase 1 — Setup

- [x] T001 Baseline: `npm run test` e `npm run typecheck` verdes.

---

## Fase 2 — US1: Conversas na ficha (P1) 🎯 MVP

- [x] T002 [US1] Em `src/components/contacts/contact-detail-view.tsx`, adicionar a query das conversas do contato usando `CONVERSATION_SELECT`/`normalizeConversation` de `@/lib/inbox/conversations`, filtrando por `contact_id` (account-scoped), ordenado por `last_message_at` desc. (FR-001, FR-006, FR-007)
- [x] T003 [US1] Renderizar a seção "Conversas": cada item com status, prévia (`last_message_text`), data (`last_message_at`) e indicador de `unread_count`. Lista suporta N itens. (FR-002, FR-005)
- [x] T004 [US1] Cada item linka para `/inbox?c=<conversationId>` (deep link existente). (FR-003)
- [x] T005 [US1] Estado vazio ("Nenhuma conversa ainda") quando o contato não tem conversa. (FR-004)
- [x] T006 [P] [US1] Adicionar os rótulos ("Conversas", "Nenhuma conversa ainda", etc.) a `en.json` e `pt.json`, mantendo paridade (feature 002). (FR-008)
- [ ] T007 [US1] `npm run test` + `npm run typecheck` + verificação no dev: ficha com conversa mostra e linka; ficha sem conversa mostra vazio. (SC-001..003)

---

## Fase 3 — Polimento & Verificação

- [ ] T008 [P] Verificar suporte a N conversas: criar 2 conversas para um contato em ambiente de teste e confirmar que ambas aparecem, ordenadas. (SC-004)
- [x] T009 `code-review` na diff (foco: account-scoping, render robusto, reuso correto dos helpers da inbox).

---

## Dependências & Ordem

- T001 → T002 → T003 → T004/T005 → **T007**. T006 `[P]` (i18n) em paralelo.
- Fase 3 por último.

## Estratégia de entrega

- **MVP = US1** (T001–T007): a ficha passa a mostrar e abrir as conversas do contato.

## Paralelismo

- T006 (i18n) ∥ T003/T004/T005.
- T008 (teste N conversas) ∥ T009.
