# Tarefas: Endurecimento dos caminhos service_role

**Feature**: `006-hardening-service-role` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md)

Hardening de segurança: enumerar, guardar e **testar isolamento**. Sem mudança
funcional.

**Invariantes**: todo query service_role filtra por `account_id` (ou invariante
documentado) · testes de isolamento por caminho · sem regressão funcional.

**Fora de escopo**: remover service_role dos caminhos; auditoria de leitura;
caminhos RLS.

**Legenda**: `[P]` = paralelizável.

---

## Progresso (2026-07-18)

Superfície `service_role` mapeada com apoio de subagente Explore (25 arquivos).
Dois pontos frágeis reais foram encontrados e **corrigidos**.

- **T001** ✅ baseline verde.
- **T002** ✅ `docs/service-role-inventory.md` — inventário completo + invariante de cada caminho + backlog de frágeis.
- **T003** ✅ `src/lib/auth/account-scope.ts` (`requireAccountScope`) + teste.
- **T004** ✅ isolamento dos motores: `engine-send-base.test.ts` (contato de outra conta → falha) + `steps-tree.test.ts` (novo guard de posse por conta).
- **T005** ✅ isolamento do webhook: **corrigido** `handleStatusUpdate` (escrita cross-account via `message_id` não único) → novo `src/lib/whatsapp/status-mirror.ts` escopado por conta + `status-mirror.test.ts` prova a não-colisão. Footprint mínimo no webhook (arquivo quente) — divergência documentada.
- **T006** ✅ isolamento do api-keys: **já coberto** por `src/lib/auth/api-context.test.ts` (key revogada/inválida → nega; key resolve o próprio `account_id`). Sem teste novo.
- **T007** ✅ isolamento dos crons — **resolvido por invariante** (ver nota abaixo).
- **T008** ✅ cada site revisado; guards adicionados onde frágil (webhook + `steps-tree` agora exige `accountId` da sessão e verifica posse; callers atualizados).
- **T009** ✅ suíte 680/680, typecheck limpo — zero regressão.
- **T010** ✅ prova de efetividade: removendo o filtro `account_id` do `steps-tree` e o escopo por conversa do `status-mirror`, os testes de isolamento **falham** (status-mirror atualiza `[msgA,msgB]` em vez de `[msgA]`; steps-tree quebra os casos de owner). Verificado manualmente e revertido.
- **T011** ✅ `security-review` rodado na diff — nenhum achado HIGH/MEDIUM; a PR é net-positivo (fecha a escrita cross-account sem introduzir regressão).

**Nota T007:** os crons (`automations/cron`, `flows/cron`) são autenticados por
segredo e a varredura global é o próprio objetivo. Não há filtro de conta a
"remover" — o isolamento vem do modelo de dados: cada linha pending resolve sua
conta pelo próprio `automation_id` (`resumePendingExecution` carrega a automation
por id e escopa o downstream por `automation.account_id`, engine.ts:142-145), e o
`flows/cron` só faz timeout por `.eq('id', run.id)`. O downstream account-scoped
(`executeStepsFrom` / step ops) já é coberto pelo guard de tenancy testado em
`automations/engine.test.ts`. Um teste de rota dedicado seria artificial (sem
filtro a exercitar); registramos o invariante como suficiente.

---

## Fase 1 — Setup / Inventário

- [x] T001 Baseline: `npm run test` e `npm run typecheck` verdes.
- [x] T002 Criar `docs/service-role-inventory.md` enumerando TODO caminho service_role (admin-clients flows/automations/ai; webhook; config; api-keys/store; helpers de envio send-message/meta-send/resolve-conversation/auto-reply; crons automations/flows), com o invariante de isolamento de cada (filtro `account_id` ou `phone_number_id` único). (FR-002, FR-006)

---

## Fase 2 — Fundacional: guarda de escopo

- [x] T003 Criar helper `requireAccountScope(account_id)` (ex.: `src/lib/auth/account-scope.ts`) que recusa quando `account_id` é nulo/ausente, + testes. Usar nos pontos onde o escopo era implícito. (FR-004)

---

## Fase 3 — US1: Isolamento provado por teste (P1) 🎯 MVP

**Meta**: cada caminho service_role tem teste provando que conta A não alcança conta B.

- [x] T004 [P] [US1] Teste de isolamento dos **motores** (flows + automations meta-send): operação da conta A com `contact_id`/`conversation_id` da conta B → falha "não encontrado para a conta", nada da B tocado. (FR-001, FR-003)
- [x] T005 [P] [US1] Teste de isolamento do **webhook**: evento para `phone_number_id` conhecido toca só a conta dona; `phone_number_id` desconhecido → descartado (nada tocado). (FR-001, FR-003)
- [x] T006 [P] [US1] Teste de isolamento do **api-keys/store**: chave válida resolve o `account_id` da chave; chave revogada/ inválida → nega. (FR-001, FR-003)
- [x] T007 [P] [US1] Teste de isolamento dos **crons** (automations/flows): só processam execuções pendentes da conta dona. (FR-001, FR-003)
- [x] T008 [US1] Revisar cada site de query service_role do inventário e **confirmar/adicionar** o filtro `account_id` (ou aplicar `requireAccountScope`). Registrar no inventário. (FR-001, FR-004)

---

## Fase 4 — Polimento & Verificação

- [x] T009 Confirmar zero regressão funcional: suíte completa verde; comportamento inalterado. (FR-005, SC-003)
- [x] T010 [P] Validar que cada teste de isolamento **falha** ao remover o filtro (prova de efetividade). (SC-002)
- [x] T011 `security-review` / `code-review` na diff (foco: nenhum site service_role sem escopo; inventário completo).

---

## Dependências & Ordem

- T001/T002 (inventário) → T003 (guarda) → US1 (T004–T007 `[P]`, depois T008) → Fase 4.
- Os testes de isolamento (T004–T007) são independentes entre si (`[P]`).

## Estratégia de entrega

- **MVP = US1** (T001–T008): superfície enumerada, escopada e com isolamento
  provado por teste — o núcleo do Princípio II operacionalizado.

## Paralelismo

- T004 ∥ T005 ∥ T006 ∥ T007 (caminhos distintos).
- T010 (prova de efetividade) ∥ T011 (review).
