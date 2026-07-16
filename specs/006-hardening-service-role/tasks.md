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

## Fase 1 — Setup / Inventário

- [ ] T001 Baseline: `npm run test` e `npm run typecheck` verdes.
- [ ] T002 Criar `docs/service-role-inventory.md` enumerando TODO caminho service_role (admin-clients flows/automations/ai; webhook; config; api-keys/store; helpers de envio send-message/meta-send/resolve-conversation/auto-reply; crons automations/flows), com o invariante de isolamento de cada (filtro `account_id` ou `phone_number_id` único). (FR-002, FR-006)

---

## Fase 2 — Fundacional: guarda de escopo

- [ ] T003 Criar helper `requireAccountScope(account_id)` (ex.: `src/lib/auth/account-scope.ts`) que recusa quando `account_id` é nulo/ausente, + testes. Usar nos pontos onde o escopo era implícito. (FR-004)

---

## Fase 3 — US1: Isolamento provado por teste (P1) 🎯 MVP

**Meta**: cada caminho service_role tem teste provando que conta A não alcança conta B.

- [ ] T004 [P] [US1] Teste de isolamento dos **motores** (flows + automations meta-send): operação da conta A com `contact_id`/`conversation_id` da conta B → falha "não encontrado para a conta", nada da B tocado. (FR-001, FR-003)
- [ ] T005 [P] [US1] Teste de isolamento do **webhook**: evento para `phone_number_id` conhecido toca só a conta dona; `phone_number_id` desconhecido → descartado (nada tocado). (FR-001, FR-003)
- [ ] T006 [P] [US1] Teste de isolamento do **api-keys/store**: chave válida resolve o `account_id` da chave; chave revogada/ inválida → nega. (FR-001, FR-003)
- [ ] T007 [P] [US1] Teste de isolamento dos **crons** (automations/flows): só processam execuções pendentes da conta dona. (FR-001, FR-003)
- [ ] T008 [US1] Revisar cada site de query service_role do inventário e **confirmar/adicionar** o filtro `account_id` (ou aplicar `requireAccountScope`). Registrar no inventário. (FR-001, FR-004)

---

## Fase 4 — Polimento & Verificação

- [ ] T009 Confirmar zero regressão funcional: suíte completa verde; comportamento inalterado. (FR-005, SC-003)
- [ ] T010 [P] Validar que cada teste de isolamento **falha** ao remover o filtro (prova de efetividade). (SC-002)
- [ ] T011 `security-review` / `code-review` na diff (foco: nenhum site service_role sem escopo; inventário completo).

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
