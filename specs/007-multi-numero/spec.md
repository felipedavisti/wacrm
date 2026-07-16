# Especificação de Funcionalidade: Múltiplos números por conta

**Feature Branch**: `007-multi-numero`

**Criada em**: 2026-07-16

**Status**: Rascunho

**Entrada**: Uma conta hoje tem **exatamente um** número de WhatsApp
(`whatsapp_config UNIQUE(account_id)` + `.single()` espalhado). O produto precisa
de **N números por conta**, inclusive em **Meta Apps diferentes**.

> **Design detalhado**: o modelo de dados completo, o mapa de call sites e os
> riscos estão em **`docs/spec-multi-numero.md`** — esta spec formaliza aquele
> documento em user stories/requisitos/critérios. É uma **mudança de axioma**,
> não uma feature isolada.

> **Dependências entre specs**: a costura `resolveConfig` da **001**
> (engine-send-base) é o ponto que esta spec troca ("por conta" → "por conversa"),
> transformando ~13 call sites em 1. A **004** (conversas na ficha) dá a
> visibilidade de threads por número. A **006** garante o isolamento dos
> caminhos service_role, incluindo o webhook multi-app.

## Decisões de produto (já tomadas)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Mesmo contato em 2 números | **Um único contato** (compartilhado) |
| 2 | Conversa em 2 números | **Threads separadas** (modelo de caixas) |
| 3 | Resposta sai por qual número | **Pelo número em que chegou** (agente não escolhe) |
| 4 | Templates | **Por WABA** (seletor filtra pela WABA do número) |
| 5 | Broadcast | **Área geral**; o número é um campo do disparo |
| 6 | Saída fria | **O agente escolhe o número na hora** |

Consequência: **existe exatamente um seletor de número em todo o produto** — na
saída fria. Em nenhum outro lugar o agente escolhe por onde a mensagem sai.

## Cenários de Usuário & Testes *(obrigatório)*

### User Story 1 - Configurar N números na conta (Priority: P1) 🎯 MVP base

O operador cadastra **vários** números na conta, cada um com sua config
(inclusive números em Meta Apps diferentes). Settings deixa de ser "um formulário"
e vira uma **lista** de números.

**Por que esta prioridade**: nada mais funciona sem poder cadastrar o 2º número.

**Independent Test**: cadastrar dois números (mesma e/ou WABAs diferentes) e ver
os dois listados e conectados.

**Acceptance Scenarios**:

1. **Given** uma conta com um número, **When** o operador adiciona um segundo,
   **Then** ambos ficam salvos e conectados (drop do `UNIQUE(account_id)`).
2. **Given** números em Meta Apps diferentes, **When** cadastrados, **Then** cada
   App (app_secret/verify_token/app_id) é guardado em `meta_apps` e vinculado.

---

### User Story 2 - Receber e responder pelo número certo (Priority: P1)

Cada conversa "sabe" por qual número entrou; a resposta do agente **sai pelo
mesmo número**, sem ele escolher.

**Por que esta prioridade**: é o coração do comportamento multi-número (decisões
#2 e #3).

**Independent Test**: o mesmo contato manda mensagem em dois números → duas
threads separadas; responder em cada uma sai pelo número correspondente.

**Acceptance Scenarios**:

1. **Given** um contato que escreve no número X, **When** a conversa é criada,
   **Then** ela registra `whatsapp_config_id = X`.
2. **Given** o mesmo contato escreve no número Y, **When** processado, **Then**
   uma **segunda** thread é criada (índice `(account_id, contact_id,
   whatsapp_config_id)`), não fundida com a de X.
3. **Given** o agente responde numa thread, **When** envia, **Then** a mensagem
   sai pelo número daquela thread (via `resolveConfig` por conversa — costura da 001).

---

### User Story 3 - Webhook multi-app (Priority: P1)

Eventos de números em Meta Apps diferentes chegam na mesma URL e são
**autenticados** corretamente, cada um com o app_secret do seu App.

**Por que esta prioridade**: sem isso, números do 2º App são rejeitados (o
`META_APP_SECRET` único de hoje só valida um App).

**Independent Test**: enviar eventos assinados por dois Apps distintos → ambos
aceitos; assinatura inválida → rejeitada.

**Acceptance Scenarios**:

1. **Given** dois Apps cadastrados em `meta_apps`, **When** chega um POST,
   **Then** a assinatura é validada testando os app_secrets em cache até bater
   (try-all-secrets), mantendo o **fail-closed**.
2. **Given** nenhum secret bate, **When** o POST chega, **Then** 401 (nunca
   "passa por não achar config").

---

### User Story 4 - Templates por WABA (Priority: P2)

Ao enviar template, o seletor mostra **só** os templates da WABA do número em
questão.

**Independent Test**: com números em WABAs diferentes, abrir o seletor num
contexto de cada número e ver apenas os templates daquela WABA.

**Acceptance Scenarios**:

1. **Given** `message_templates` com `waba_id`, **When** o seletor abre para um
   número, **Then** filtra pela WABA daquele número.
2. **Given** o sync de templates, **When** roda, **Then** sincroniza **por WABA**
   (não uma vez por conta).

---

### User Story 5 - Broadcast escolhe o número (Priority: P2)

No broadcast (área geral), o operador escolhe **de qual número** o disparo sai; o
seletor de template passa a ser filtrado pela WABA daquele número.

**Independent Test**: criar um broadcast, escolher o número, ver os templates
filtrados, disparar, e as threads caírem naquele número.

**Acceptance Scenarios**:

1. **Given** o wizard de broadcast, **When** o operador cria um disparo, **Then**
   um passo novo escolhe o número (`broadcasts.whatsapp_config_id`), **antes** do
   template.
2. **Given** o disparo sai do número X, **When** um contato responde, **Then** a
   thread cai no número X.

---

### User Story 6 - Saída fria escolhe o número (Priority: P2)

Ao iniciar conversa com um contato que nunca falou, o agente **escolhe o número**
de saída — o único seletor de número do produto.

**Independent Test**: iniciar conversa fria com um contato, escolher número,
enviar template; a thread nasce naquele número.

**Acceptance Scenarios**:

1. **Given** um contato sem conversa, **When** o agente inicia uma conversa,
   **Then** ele escolhe o número e a thread nasce vinculada a ele.

---

### Edge Cases

- **Migration da 036**: o índice `(account_id, contact_id)` DEVE virar
  `(account_id, contact_id, whatsapp_config_id)`, senão mensagens de dois números
  **fundem** na mesma thread silenciosamente (risco central — ver doc).
- **`flow_runs`** (run ativa por contato): o índice parcial DEVE incluir o número.
- **Número em App de terceiro**: se o número pertence a um Meta App que não é o
  do operador, os eventos não chegam (documentar; fora de escopo resolver).
- **Rotação de app_secret**: com `meta_apps`, é update em **uma** linha.
- **Entrada já funciona**: o webhook já roteia por `phone_number_id`; dropar o
  `UNIQUE(account_id)` não quebra a entrada.

## Requirements *(obrigatório)*

### Functional Requirements

- **FR-001**: `whatsapp_config` DEVE permitir N linhas por conta (dropar
  `UNIQUE(account_id)`); `UNIQUE(phone_number_id)` (013) permanece.
- **FR-002**: DEVE existir `meta_apps` (app_id, app_secret, verify_token
  criptografados) e `whatsapp_config.meta_app_id` FK; app_secret/verify_token
  saem do `.env`.
- **FR-003**: `conversations` DEVE ter `whatsapp_config_id` (NOT NULL) e o índice
  de dedupe DEVE incluí-lo `(account_id, contact_id, whatsapp_config_id)`.
- **FR-004**: A resolução de config no envio DEVE ser **por conversa** (trocar a
  costura `resolveConfig` da 001), não `.single()` por conta.
- **FR-005**: O webhook DEVE autenticar multi-app (try-all-secrets sobre
  `meta_apps`), mantendo o fail-closed.
- **FR-006**: `message_templates` DEVE ter `waba_id`; o seletor filtra por WABA; o
  sync roda por WABA.
- **FR-007**: `broadcasts` DEVE ter `whatsapp_config_id`; o wizard escolhe o
  número antes do template.
- **FR-008**: A saída fria DEVE oferecer a escolha do número (único seletor).
- **FR-009**: `flow_runs` — o índice de run ativa por contato DEVE incluir o número.
- **FR-010**: A resposta a uma conversa DEVE sair pelo número da conversa
  (decisão #3); o agente não escolhe (exceto saída fria).
- **FR-011**: Migrations na faixa **`500_`+**; divergências do upstream
  documentadas (Constitution, Princípio V).
- **FR-012**: Rótulos novos no i18n (feature 002).

### Key Entities *(inclui dados)*

- **meta_apps** (novo): App Meta (app_id, app_secret, verify_token) por conta;
  N `whatsapp_config` apontam para um App.
- **whatsapp_config**: N por conta; ganha `meta_app_id`.
- **conversations**: ganha `whatsapp_config_id`; identidade da thread passa a
  incluir o número.
- **message_templates**: ganha `waba_id`.
- **broadcasts**: ganha `whatsapp_config_id`.

## Success Criteria *(obrigatório)*

### Measurable Outcomes

- **SC-001**: Uma conta opera **2+ números** simultaneamente (receber e enviar
  por cada um).
- **SC-002**: O mesmo contato em dois números gera **duas threads separadas**;
  nenhuma fusão.
- **SC-003**: Responder numa thread sai **sempre** pelo número daquela thread.
- **SC-004**: Eventos de dois Meta Apps distintos são autenticados; assinatura
  inválida é rejeitada (fail-closed).
- **SC-005**: O seletor de template mostra só os da WABA do número; broadcast e
  saída fria escolhem o número.

## Assumptions

- Um deployment por cliente (a multi-tenancy protege times dentro do cliente).
- A 001 (engine-send-base) está implementada ou será — a costura `resolveConfig`
  é o ponto de troca. Se a 001 ainda não estiver mergeada, esta spec a assume
  como pré-requisito.
- O detalhamento de schema/call-sites vive em `docs/spec-multi-numero.md`.

## Dependencies

- **Pré-requisito**: 001 (costura de config). **Complementa**: 004 (visibilidade
  de threads), 006 (isolamento do webhook multi-app).
- Migrations `500_`+; toca a área mais quente do upstream (webhook, whatsapp_config,
  índice 036) — divergência deliberada e documentada.
