# Especificação de Funcionalidade: Conversas na ficha do contato

**Feature Branch**: `004-conversas-na-ficha`

**Criada em**: 2026-07-16

**Status**: Rascunho

**Entrada**: A ficha do contato mostra negócios, tags, notas e campos
customizados — mas **não** as conversas daquele contato.

> **Achado do fonte**: `contact-detail-view.tsx` consulta `contacts, tags,
> contact_tags, contact_notes, custom_fields, contact_custom_values, deals` —
> nunca `conversations`. A inbox abre uma conversa por deep link
> **`/inbox?c=<conversationId>`** (`inbox/page.tsx:33`), padrão que o dashboard
> já usa. Conversas ligam ao contato por `conversations.contact_id`.

> **Relação com multi-número**: hoje (um número por conta + índice único da
> migration 036) um contato tem tipicamente **uma** conversa. Esta feita já
> DEVE listar **N** (por número), tornando-se a peça que resolve a visibilidade
> de threads quando a multi-número existir — o agente vê que o contato já tem
> conversa em outro número. Sem migration.

## Cenários de Usuário & Testes *(obrigatório)*

### User Story 1 - Ver as conversas do contato na ficha (Priority: P1) 🎯 MVP

Abrindo a ficha de um contato, o agente vê a(s) **conversa(s)** daquele contato,
com status e última atividade, e pode **abrir** cada uma na inbox com um clique.

**Por que esta prioridade**: é a razão da feature. A ficha é o único lugar que
consolida "quem é esse contato"; sem as conversas, falta o essencial —
especialmente com múltiplos números no futuro.

**Teste independente**: abrir a ficha de um contato que tem conversa → a conversa
aparece com status e data da última mensagem; clicar abre a conversa certa na
inbox.

**Acceptance Scenarios**:

1. **Given** um contato com uma conversa, **When** a ficha é aberta, **Then** a
   conversa aparece com status, prévia/última mensagem e data.
2. **Given** a conversa listada, **When** o agente clica nela, **Then** a inbox
   abre naquela conversa (`/inbox?c=<id>`).
3. **Given** um contato **sem** conversa, **When** a ficha é aberta, **Then**
   um estado vazio claro é exibido (sem erro).
4. **Given** (futuro multi-número) um contato com conversas em números
   diferentes, **When** a ficha é aberta, **Then** todas aparecem, identificando
   o número de cada uma.

---

### Edge Cases

- **Contato sem conversa**: estado vazio explícito.
- **Conversa fechada/arquivada**: aparece na lista com o status correspondente.
- **Muitas conversas** (futuro): a lista ordena por atividade recente
  (`last_message_at` desc); pode limitar/rolar.
- **Isolamento**: a listagem é account-scoped (a RLS já cobre no client; manter
  o filtro por conta como as demais queries da ficha).

## Requirements *(obrigatório)*

### Functional Requirements

- **FR-001**: A ficha do contato DEVE listar as conversas daquele contato
  (`conversations` por `contact_id`, account-scoped).
- **FR-002**: Cada item DEVE exibir status, data da última mensagem e uma
  prévia/indicador de não-lidas.
- **FR-003**: Cada item DEVE abrir a conversa na inbox via `/inbox?c=<id>`.
- **FR-004**: DEVE tratar o caso de contato sem conversa com um estado vazio.
- **FR-005**: A listagem DEVE suportar **N** conversas por contato (lista, não
  registro único), para ser compatível com o futuro multi-número — identificando
  o número quando houver mais de um.
- **FR-006**: Ordenar por `last_message_at` desc (atividade recente primeiro).
- **FR-007**: NÃO DEVE haver migration — usa `conversations.contact_id` já
  existente.
- **FR-008**: Rótulos de UI entram no i18n (feature 002), em pt-BR e en.

### Key Entities *(inclui dados)*

- **Conversa** (`conversations`): já ligada ao contato por `contact_id`; carrega
  `status`, `last_message_text`, `last_message_at`, `unread_count`. (Futuro:
  `whatsapp_config_id` para identificar o número — multi-número.)
- **Ficha do contato**: agrega dados do contato + agora as conversas.

## Success Criteria *(obrigatório)*

### Measurable Outcomes

- **SC-001**: Abrindo a ficha de um contato com conversa, a conversa aparece com
  status e última atividade.
- **SC-002**: Clicar na conversa abre exatamente aquela conversa na inbox.
- **SC-003**: Contato sem conversa exibe estado vazio, sem erro de render.
- **SC-004**: A seção suporta e exibe corretamente múltiplas conversas (validável
  criando duas conversas para um contato em ambiente de teste).

## Assumptions

- Reusar `CONVERSATION_SELECT`/`normalizeConversation` de `@/lib/inbox/conversations`
  para consistência com a inbox.
- A ficha é a `contact-detail-view.tsx`; a seção de conversas fica junto das de
  negócios/notas.
- Hoje tipicamente 1 conversa por contato (índice único 036); a lista já
  contempla N para o multi-número.

## Dependencies

- Complementa a spec de **multi-número**: é a tela que dá visibilidade das
  threads por número (resolve a preocupação de "saída fria" discutida no produto).
- Independente das specs 001/002/003.
