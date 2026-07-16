# Especificação de Funcionalidade: Endurecimento dos caminhos service_role

**Feature Branch**: `006-hardening-service-role`

**Criada em**: 2026-07-16

**Status**: Rascunho

**Entrada**: Os caminhos que usam o client `service_role` **ignoram a RLS**. A
constituição (Princípio II) os nomeia como "a superfície de auditoria". Esta
feature os enumera, garante o escopo por conta, e **prova o isolamento com testes**.

> **Achado do fonte**: a superfície `service_role` é: os 3 admin-clients
> idênticos (`src/lib/{flows,automations,ai}/admin-client.ts`), o webhook
> (`api/whatsapp/webhook/route.ts`, ~29 usos), a rota de config
> (`api/whatsapp/config/route.ts`), o store de API keys (`lib/api-keys/store.ts`)
> e os helpers de envio que usam `supabaseAdmin` (`send-message.ts`,
> `{flows,automations}/meta-send.ts`, `resolve-conversation.ts`,
> `ai/auto-reply.ts`). Nesses caminhos, o isolamento entre contas **não é
> garantido pela RLS** — depende de o código filtrar por `account_id`
> explicitamente (padrão já observado nos meta-send, mas sem teste que o prove).

> **Natureza**: hardening de segurança. Sem mudança de comportamento funcional;
> o valor é **garantia comprovada** de isolamento e uma convenção que impede
> regressão.

## Cenários de Usuário & Testes *(obrigatório)*

### User Story 1 - Isolamento entre contas provado por teste (Priority: P1) 🎯 MVP

Uma operação disparada no contexto da conta A (uma automação, um flow, um envio,
o webhook de um número da conta A) **não consegue** ler nem escrever dados da
conta B — e isso é **garantido por teste**, não por inspeção manual.

**Por que esta prioridade**: é o coração do requisito. Sem teste, o isolamento é
uma promessa; com teste, é uma garantia que falha se alguém remover o filtro.

**Teste independente**: para cada caminho service_role, um teste que tenta
alcançar dados de outra conta (ex.: automação da conta A referenciando um
`contact_id` da conta B) e confirma que a operação **falha/não vaza**.

**Acceptance Scenarios**:

1. **Given** uma automação/flow da conta A com um `contact_id` da conta B,
   **When** o motor executa o envio, **Then** a operação falha (contato não
   encontrado **para a conta A**) e nada da conta B é lido/alterado.
2. **Given** o webhook recebe evento para um `phone_number_id`, **When**
   resolve a config, **Then** só toca dados da conta dona daquele número.
3. **Given** o store de API keys valida uma chave, **When** resolve o contexto,
   **Then** o `account_id` derivado é o da chave, sem acesso cruzado.

---

### User Story 2 - Superfície enumerada e guardada (Priority: P2)

O time tem um **inventário** dos caminhos service_role e uma **convenção** que
torna o escopo por conta explícito, de modo que adicionar um novo caminho sem
isolamento seja evidente na revisão.

**Por que esta prioridade**: sustenta o Princípio II no tempo — a superfície não
cresce silenciosamente. P2 porque a prova (US1) vem primeiro.

**Teste independente**: revisar o inventário e confirmar que cada query
service_role filtra por `account_id` (ou é comprovadamente segura por outro
invariante, como o webhook por `phone_number_id` único).

**Acceptance Scenarios**:

1. **Given** o inventário dos caminhos service_role, **When** revisado, **Then**
   cada site de query filtra por `account_id` ou documenta o invariante que o
   torna seguro.
2. **Given** um novo caminho service_role hipotético sem `account_id`, **When**
   revisado, **Then** a convenção/guarda o sinaliza.

---

### Edge Cases

- **Webhook por `phone_number_id`**: o isolamento vem do mapeamento único número
  → conta (constraint 013). O teste DEVE cobrir o caso de número desconhecido
  (evento é descartado, nada é tocado).
- **Cron de automações/flows**: executa sem sessão; DEVE operar só sobre execuções
  pendentes da conta dona daquela execução.
- **API key revogada/ inválida**: o store NÃO DEVE resolver contexto (nega acesso).
- **`account_id` ausente no input**: a guarda DEVE recusar em vez de rodar sem
  filtro.

## Requirements *(obrigatório)*

### Functional Requirements

- **FR-001**: Todo query via client `service_role` DEVE filtrar por `account_id`
  ou documentar o invariante que o torna seguro (ex.: webhook por
  `phone_number_id` único).
- **FR-002**: DEVE existir um **inventário enumerado** dos caminhos service_role
  (admin-clients, webhook, config, api-keys, helpers de envio, crons).
- **FR-003**: DEVEM existir **testes de isolamento** que provam que uma operação
  de uma conta não alcança dados de outra — um por caminho.
- **FR-004**: Onde o escopo for implícito/frágil, adicionar uma **guarda
  explícita** (ex.: helper que exige `account_id` e recusa quando ausente).
- **FR-005**: NÃO DEVE haver mudança de comportamento funcional (é hardening).
- **FR-006**: A convenção DEVE ser documentada de forma que um novo caminho
  service_role sem isolamento seja evidente na revisão (Princípio II).

### Key Entities *(inclui dados)*

- **Caminho service_role**: um local que usa o client `service_role` e portanto
  ignora a RLS; caracterizado por precisar de filtro `account_id` explícito.
- **Teste de isolamento**: cenário que prova que a conta A não alcança dados da
  conta B por aquele caminho.

## Success Criteria *(obrigatório)*

### Measurable Outcomes

- **SC-001**: 100% dos sites de query service_role revisados com escopo por
  `account_id` confirmado (ou invariante documentado).
- **SC-002**: Cada caminho tem teste de isolamento que **falha** se o filtro for
  removido.
- **SC-003**: Zero regressão funcional (suíte existente permanece verde).
- **SC-004**: Existe um documento/inventário dos caminhos service_role no repo.

## Assumptions

- O padrão de filtrar por `account_id` já existe nos meta-send (observado); esta
  feature o torna universal, guardado e testado.
- A migration 017 estabeleceu `account_id` como a chave de tenancy; `is_account_member`
  cobre os caminhos RLS (fora de escopo aqui — o foco é o que **ignora** RLS).

## Dependencies

- Operacionaliza o Princípio II da Constituição. Independente das demais specs
  (revisão/testes; poucas mudanças de código, só guardas).
