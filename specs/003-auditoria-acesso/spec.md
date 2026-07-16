# Especificação de Funcionalidade: Atribuição de autor da mensagem (sender_id)

**Feature Branch**: `003-auditoria-acesso`

**Criada em**: 2026-07-16

**Status**: Rascunho

**Entrada**: Assinar quem enviou cada mensagem de saída — hoje só se registra
*que* foi um agente (`sender_type='agent'`), não *qual*.

> **Escopo (e o que NÃO é)**: esta feature registra e exibe **o autor das
> mensagens enviadas por agente** (atribuição de saída). NÃO é a auditoria de
> acesso da LGPD ("quem **leu** os dados do paciente"), que permanece uma
> necessidade futura separada. A distinção foi decidida conscientemente com o PO.

> **Achado central do fonte**: a coluna `messages.sender_id UUID` **já existe**
> no schema (migration 001) e no tipo TS (`types/index.ts:225`), mas **nunca é
> preenchida** por nenhum insert. O envio manual do agente (`send-message.ts:455`)
> grava `sender_type='agent'` e deixa `sender_id` nulo. Portanto: **sem migration**
> — o trabalho é popular um campo que já existe.

## Cenários de Usuário & Testes *(obrigatório)*

### User Story 1 - Registrar o autor do envio (Priority: P1) 🎯 MVP

Quando um agente envia uma mensagem pela inbox, o sistema grava **qual agente**
enviou (`sender_id` = id do agente autenticado). Assim, cada mensagem de saída
fica assinada e auditável dentro da conta.

**Por que esta prioridade**: é a razão da feature. Sem isso, uma equipe
compartilhando um número não consegue saber quem respondeu o quê.

**Teste independente**: um agente autenticado envia uma mensagem; a linha em
`messages` tem `sender_type='agent'` **e** `sender_id` = id daquele agente.

**Acceptance Scenarios**:

1. **Given** o agente A autenticado, **When** ele envia uma mensagem numa
   conversa, **Then** a mensagem persistida tem `sender_id = A`.
2. **Given** uma mensagem de **bot** (automação/flow/auto-reply), **When**
   enviada, **Then** `sender_type='bot'` e `sender_id` é nulo (o tipo já
   distingue; não há agente humano).
3. **Given** uma mensagem de **entrada** do cliente, **When** o webhook a grava,
   **Then** `sender_type='customer'` e `sender_id` é nulo.
4. **Given** um envio pela **API pública** (chave de API, sem agente humano),
   **When** processado, **Then** `sender_id` é nulo.

---

### User Story 2 - Ver quem enviou, na inbox (Priority: P2)

Um agente (ou admin) abrindo a conversa vê, em cada mensagem de saída, **quem a
enviou** — "enviado por \<agente\>". Torna a atribuição útil no dia a dia, não só
no banco.

**Por que esta prioridade**: a atribuição sem exibição é meio-caminho. P2 porque
o registro (US1) é o que precisa existir primeiro; a exibição consome o dado.

**Teste independente**: com mensagens de agentes distintos numa conversa, a
inbox mostra o autor correto de cada uma; mensagens de bot aparecem como bot/
automação; as do cliente, sem autor.

**Acceptance Scenarios**:

1. **Given** mensagens enviadas por agentes A e B na mesma conversa, **When** a
   inbox renderiza a thread, **Then** cada mensagem mostra o agente que a enviou.
2. **Given** o agente acabou de enviar (antes da confirmação do servidor),
   **When** a mensagem otimista aparece, **Then** ela já reflete o autor (o
   próprio agente), sem "piscar" ao confirmar.

---

### Edge Cases

- **Agente removido da conta depois**: `sender_id` referencia um usuário que pode
  sair. A exibição DEVE degradar graciosamente (ex.: "agente removido") sem
  quebrar; o `sender_id` histórico permanece para auditoria.
- **API pública NÃO DEVE expor `sender_id`**: o serializer `ApiMessage`
  (`src/lib/api/v1/conversations.ts`) hoje **já omite** `sender_id` — isso DEVE
  ser preservado (não vazar a identidade interna do agente para consumidores
  externos).
- **Envio via API sem agente humano**: `sender_id` nulo (opção futura: atribuir
  ao dono da chave — fora de escopo agora).
- **Mensagem antiga (pré-feature)**: `sender_id` nulo; a exibição trata como
  "autor desconhecido" sem erro. Sem backfill (não há como saber o autor
  retroativo).

## Requirements *(obrigatório)*

### Functional Requirements

- **FR-001**: Toda mensagem enviada por um **agente humano** DEVE gravar
  `sender_id` = id do agente autenticado.
- **FR-002**: Mensagens de **bot** (automação, flow, auto-reply de IA) DEVEM ter
  `sender_id` nulo; `sender_type='bot'` continua distinguindo.
- **FR-003**: Mensagens de **entrada** (cliente) DEVEM ter `sender_id` nulo.
- **FR-004**: Envios pela **API pública** sem agente humano DEVEM gravar
  `sender_id` nulo.
- **FR-005**: `sender_id` NÃO DEVE ser exposto na API pública (`/api/v1`) —
  preservar a omissão atual no serializer `ApiMessage`.
- **FR-006**: A inbox DEVE exibir o autor de cada mensagem de saída de agente,
  resolvendo `sender_id` para o nome do agente (membros da conta).
- **FR-007**: A renderização otimista da inbox DEVE refletir o autor (o próprio
  agente) antes da confirmação do servidor, para consistência visual.
- **FR-008**: NÃO DEVE haver migration nova — a coluna `sender_id` e o tipo já
  existem. Mudança pontual nos caminhos de envio e na exibição.
- **FR-009**: A exibição DEVE degradar graciosamente quando o `sender_id` for
  nulo (mensagem antiga/bot/cliente) ou apontar para um usuário que saiu da
  conta.

### Key Entities *(inclui dados)*

- **Mensagem** (`messages`): já possui `sender_type` ('customer'/'agent'/'bot')
  e `sender_id UUID` (autor, hoje sempre nulo). Esta feature preenche `sender_id`
  no envio de agente.
- **Agente** (membro da conta / `profiles`): resolvido a partir de `sender_id`
  para exibir nome na inbox.

## Success Criteria *(obrigatório)*

### Measurable Outcomes

- **SC-001**: 100% das mensagens enviadas por agente **após** esta feature têm
  `sender_id` preenchido.
- **SC-002**: Mensagens de bot e de cliente têm `sender_id` nulo (0% preenchido).
- **SC-003**: `sender_id` **nunca** aparece na resposta da API pública.
- **SC-004**: Na inbox, uma mensagem de agente exibe corretamente quem a enviou;
  mensagens sem autor não quebram a renderização.

## Assumptions

- O envio manual do agente passa por `send-message.ts` (core compartilhado), e a
  rota `/api/whatsapp/send` **já tem** o usuário autenticado (`auth.getUser`) —
  basta propagá-lo ao core.
- Broadcasts **não** inserem em `messages` (rastreiam por `broadcast_recipients`),
  então estão fora do escopo de atribuição.
- Sem backfill de mensagens antigas (autor retroativo é desconhecido).
- A resolução `sender_id` → nome usa os membros da conta já existentes.

## Dependencies

- Relaciona-se com a spec 001 (FR-011): lá, os envios de **bot** deliberadamente
  não gravam autor; aqui, os envios de **agente** passam a gravar. Consistente.
- Não fecha o requisito LGPD de **auditoria de leitura** — que permanece uma
  spec futura separada (Constitution, Princípio I).
