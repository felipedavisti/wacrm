# Especificação de Funcionalidade: Janela de 24h proativa

**Feature Branch**: `005-janela-24h`

**Criada em**: 2026-07-16

**Status**: Rascunho

**Entrada**: Fora das 24h desde a última mensagem do cliente, a Meta só aceita
**template**. Hoje o sistema não sabe disso — tenta enviar texto livre e deixa a
Meta rejeitar, mostrando um erro cru ao agente.

> **Achado do fonte**: a janela de 24h aparece **só em comentários**
> (`meta-api.ts:230,367`), nunca é validada. Não há rastreio da última mensagem
> de **entrada** (só `last_message_at`, que conta qualquer mensagem). O erro da
> Meta para "fora da janela" (**131047 / re-engagement**) não é tratado em lugar
> nenhum. Constituição, Princípio III: a janela de 24h é uma **restrição
> permanente do produto** que DEVE ser tratada graciosamente.

## Cenários de Usuário & Testes *(obrigatório)*

### User Story 1 - O sistema conhece e respeita a janela (Priority: P1) 🎯 MVP

Quando um agente tenta enviar **texto livre** (não-template) para um contato cuja
última mensagem foi há **mais de 24h**, o sistema **impede o envio com um erro
claro** ("janela de 24h expirada — envie um template para reabrir"), em vez de
chamar a Meta e receber uma rejeição crua. Templates continuam sempre permitidos
(reabrem a conversa).

**Por que esta prioridade**: é a razão da feature — transformar uma falha
confusa numa orientação clara. Sem o rastreio da entrada, nada disso é possível.

**Teste independente**: com uma conversa cuja última mensagem do cliente foi há
>24h, tentar enviar texto → erro claro `window_expired`; enviar template →
sucesso.

**Acceptance Scenarios**:

1. **Given** a última mensagem do **cliente** foi há menos de 24h, **When** o
   agente envia texto livre, **Then** o envio ocorre normalmente.
2. **Given** a última mensagem do cliente foi há mais de 24h, **When** o agente
   envia texto livre, **Then** o sistema recusa com `window_expired` **antes** de
   chamar a Meta, com mensagem orientando a usar template.
3. **Given** a janela expirada, **When** o agente envia um **template**, **Then**
   o envio ocorre (template reabre a janela).
4. **Given** a Meta ainda assim rejeitar por janela (erro 131047), **When** isso
   ocorre, **Then** o sistema mapeia para a mesma mensagem clara (backstop).

---

### User Story 2 - A inbox avisa proativamente (Priority: P1)

Ao abrir uma conversa fora da janela, o agente **vê** que a janela fechou —
antes de digitar — e a inbox **oferece enviar um template** em vez de texto livre.

**Por que esta prioridade**: evita a frustração de digitar e só então descobrir
que não pode enviar. Junto com a US1, fecha o tratamento gracioso.

**Teste independente**: abrir uma conversa fora da janela → o composer indica
"janela fechada" e oferece template; abrir uma dentro da janela → composer normal.

**Acceptance Scenarios**:

1. **Given** uma conversa fora da janela, **When** o agente a abre, **Then** o
   composer sinaliza a janela fechada e oferece o seletor de template.
2. **Given** uma conversa dentro da janela, **When** o agente a abre, **Then** o
   composer se comporta normalmente (texto livre disponível).

---

### Edge Cases

- **Conversa que nunca recebeu mensagem do cliente** (ex.: saída fria / contato
  importado): a janela é considerada **fechada** (nunca houve entrada) → só
  template. Consistente com a regra da Meta.
- **Mensagem chega e reabre a janela**: ao entrar uma mensagem do cliente, a
  janela reabre; a UI reflete sem precisar recarregar (real-time já existe na inbox).
- **Fuso/relógio**: o cálculo usa timestamps do servidor (UTC), não do cliente.
- **Mensagens antigas (backfill)**: para conversas existentes, o rastreio de
  entrada pode ser inicializado a partir da última mensagem de cliente conhecida
  (ou deixado nulo = janela fechada até a próxima entrada).

## Requirements *(obrigatório)*

### Functional Requirements

- **FR-001**: O sistema DEVE rastrear o horário da **última mensagem de entrada**
  (do cliente) por conversa.
- **FR-002**: O webhook DEVE atualizar esse horário sempre que uma mensagem do
  cliente chega.
- **FR-003**: O sistema DEVE considerar a janela **aberta** se a última entrada
  foi há menos de 24h; **fechada** caso contrário (ou se nunca houve entrada).
- **FR-004**: Envios de **texto livre / mídia / interativo** fora da janela DEVEM
  ser recusados com erro claro (`window_expired`) **antes** de chamar a Meta.
- **FR-005**: Envios de **template** DEVEM ser sempre permitidos (reabrem a janela).
- **FR-006**: O sistema DEVE mapear o erro **131047** da Meta para a mesma
  mensagem clara (backstop, caso a checagem local erre por corrida).
- **FR-007**: A inbox DEVE indicar proativamente quando a janela está fechada e
  oferecer o envio de template.
- **FR-008**: O cálculo da janela DEVE usar timestamps do servidor (UTC).
- **FR-009**: Rótulos/mensagens novas entram no i18n (feature 002), pt-BR e en.

### Key Entities *(inclui dados)*

- **Conversa** (`conversations`): ganha o horário da última entrada
  (`last_inbound_at`), mantido pelo webhook. A janela é derivada dele.
- **Mensagem** (`messages`): a de `sender_type='customer'` é o gatilho que
  atualiza `last_inbound_at`.

## Success Criteria *(obrigatório)*

### Measurable Outcomes

- **SC-001**: 100% dos envios de texto livre fora da janela são recusados
  localmente com mensagem clara, **sem** chamada à Meta.
- **SC-002**: Templates fora da janela são enviados com sucesso.
- **SC-003**: Ao abrir uma conversa fora da janela, o agente vê o aviso antes de
  digitar.
- **SC-004**: Uma nova mensagem do cliente reabre a janela e a UI reflete sem
  recarregar.

## Assumptions

- A janela da Meta é de 24h a partir da última mensagem do cliente. Templates
  reabrem; texto livre requer janela aberta.
- O rastreio via `conversations.last_inbound_at` (nova coluna) é preferível a
  varrer `messages` a cada envio (escalável). Migration na faixa `500_`.
- A inbox já tem real-time (para refletir reabertura da janela).

## Dependencies

- Migration nova na faixa **`500_`** (primeira do fork — Constitution, Princípio V).
- Independente das demais specs; o backend de envio toca `send-message.ts`
  (mesma área da 001, mas sem conflito — pontos diferentes).
