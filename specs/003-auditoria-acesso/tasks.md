# Tarefas: Atribuição de autor da mensagem (sender_id)

**Feature**: `003-auditoria-acesso` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md)

Feature pequena, **sem migration** (coluna `sender_id` e tipo já existem).
Abordagem test-first no core.

**Invariantes globais**: envio de agente grava `sender_id` · bot/customer/API
ficam nulos · API pública **não** expõe `sender_id` · sem migration · exibição
degrada sem quebrar quando não há autor · rótulos novos vão para o i18n (feature 002).

**Fora de escopo**: auditoria de leitura (LGPD); backfill de mensagens antigas;
atribuir envios de API ao dono da chave.

**Legenda**: `[P]` = paralelizável.

---

## Progresso (2026-07-18)

Feature completa. Sem migration (coluna `sender_id` já existia). Suíte 688/688,
typecheck limpo.

- **US1 (T002–T006)** ✅ `send-message.ts` grava `sender_id`; `/api/whatsapp/send`
  passa `user.id`; `/api/v1/messages` passa `null`. Bot/customer/API nulos.
  Testes de caracterização do core (com/sem `senderId`).
- **US2 (T007–T010)** ✅ `message-bubble` exibe o autor de mensagens de agente;
  `message-thread` resolve `sender_id → full_name` via `profiles` (RLS `profiles_select`
  retorna membros da conta — 017), com `sender_id` nos 4 otimistas (sem flicker).
  i18n `unknownAuthor`/`sentByTitle` em `en.json`+`ko.json` (`pt.json` virá na 002).
- **T011** ✅ guard: teste prova que `serializeMessage` nunca expõe `sender_id`.
- **T012** ✅ verificação de exibição por **render test** (`message-bubble.test.tsx`,
  `renderToStaticMarkup`) cobrindo os 5 casos de atribuição — não depende de número
  conectado. O e2e **ao vivo** (dois agentes enviando de verdade) fica para quando
  um número WhatsApp estiver conectado no ambiente.
- **T013** ✅ `/code-review` (high): nenhum bug; 1 limpeza aplicada (resolução do
  autor via `Map` memoizado).

---

## Fase 1 — Setup

- [x] T001 Baseline: `npm run test` e `npm run typecheck` verdes.

---

## Fase 2 — US1: Registrar o autor do envio (P1) 🎯 MVP

**Meta**: envio de agente grava `sender_id`; demais caminhos ficam nulos.

**Teste independente**: agente autenticado envia → `messages.sender_id` = agente.

- [x] T002 [US1] Adicionar `senderId?: string | null` a `SendMessageParams` em `src/lib/whatsapp/send-message.ts` e gravar `sender_id: senderId ?? null` no insert de `messages` (hoje linha ~455). (FR-001, FR-002, FR-008 — conforme contracts/sender-id.md)
- [x] T003 [US1] Em `src/app/api/whatsapp/send/route.ts`, passar `user.id` (de `auth.getUser`) como `senderId` na chamada a `sendMessageToConversation`. (FR-001)
- [x] T004 [US1] Em `src/app/api/v1/messages/…`, passar `senderId: null` (sem agente humano) na chamada ao core. (FR-004)
- [x] T005 [P] [US1] Testes em `src/lib/whatsapp/send-message.test.ts`: (a) com `senderId` → `sender_id` gravado; (b) sem `senderId` → `sender_id` nulo. Confirmar que bot/customer (outros caminhos) permanecem nulos.
- [x] T006 [US1] Rodar `npm run test` + `npm run typecheck` — verde. Verificar no dev que uma mensagem de agente grava o `sender_id` correto e que um flow grava nulo. (SC-001, SC-002)

**Checkpoint US1**: atribuição no banco funcionando; MVP entregue.

---

## Fase 3 — US2: Ver quem enviou, na inbox (P2)

**Meta**: exibir "enviado por \<agente\>" nas mensagens de saída de agente.

**Teste independente**: mensagens de agentes distintos mostram o autor correto;
bot/cliente sem autor; nada quebra.

- [x] T007 [US2] Em `src/components/inbox/message-thread.tsx`, resolver `sender_id` → nome do agente usando os **membros da conta já carregados**, e exibir "enviado por \<nome\>" nas mensagens de saída de agente. (FR-006)
- [x] T008 [US2] Degradar graciosamente: `sender_id` nulo (bot/cliente/mensagem antiga) → sem autor; `sender_id` de ex-membro → "autor desconhecido". Sem erro de render. (FR-009)
- [x] T009 [US2] Incluir `sender_id` = agente atual nos 4 objetos **otimistas** de `message-thread.tsx` para a exibição não "piscar" ao confirmar. (FR-007)
- [x] T010 [P] [US2] Adicionar os rótulos de UI ("enviado por", "autor desconhecido") aos dicionários `en.json` e `pt.json` (respeitando a feature 002; manter paridade de chaves).

---

## Fase 4 — Polimento & Verificação

- [x] T011 [P] Confirmar que a API pública NÃO expõe `sender_id`: `ApiMessage` inalterado; se prático, um teste que falha se `sender_id` aparecer no serializer. (FR-005, SC-003)
- [x] T012 Verificação end-to-end (quickstart §2): dois agentes, um bot; inbox e banco conferem; `GET /api/v1/.../messages` sem `sender_id`.
- [x] T013 `code-review` na diff (foco: nenhum caminho de agente esquecido; API pública intacta; render robusto a autor nulo).

---

## Dependências & Ordem

- **T001** antes de tudo.
- **US1 (MVP)**: T002 → T003/T004 → **T005** → T006. T005 `[P]` (arquivo de teste).
- **US2**: T007 → T008 → T009; T010 `[P]` (i18n). Depois da US1.
- **Fase 4** por último.

## Estratégia de entrega

- **MVP = US1** (T001–T006): a mensagem fica assinada no banco — o pedido central.
- **US2** torna a assinatura visível na inbox.

## Oportunidades de paralelismo

- T005 (testes do core) ∥ implementação de T003/T004.
- T010 (i18n) ∥ T007/T008 (exibição).
- T011 (guard da API) ∥ US2.
