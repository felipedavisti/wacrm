# Especificação de Funcionalidade: Engine Send Base compartilhada

**Feature Branch**: `001-engine-send-base`

**Criada em**: 2026-07-16

**Status**: Rascunho

**Entrada**: Consolidar a lógica de envio duplicada entre os dois motores
(automations = regras de CRM; flows = chatbot conversacional), mantendo os
**dois** paradigmas, e deixar a resolução do número de WhatsApp pronta para
múltiplos números.

> **Natureza desta spec**: é um refactor interno de dívida técnica. O valor não
> é uma tela nova — é **comportamento idêntico com menos código duplicado** e uma
> **costura única** que habilita a futura funcionalidade de múltiplos números.
> Por isso os "usuários" abaixo são o operador final (que não deve notar
> diferença) e o time da Fnx (que passa a manter um lugar em vez de quatro).

## Clarifications

### Session 2026-07-16

- Q: O `userId` (autor) é recebido pelos adaptadores mas não é usado na
  persistência hoje — o que a base faz com ele? → A: **Omitir da base.** Os
  adaptadores preservam a assinatura pública (recebem `userId`), mas a base
  `sendFromEngine` não o conhece nem o grava. Comportamento idêntico ao atual. A
  atribuição de autor/sender é trabalho deliberado da futura spec de Auditoria
  (Princípio I), não deste refactor.
- Q: Os motores embrulham os erros lançados em seus logs
  (`automation_logs`/`flow_run_events`) — como tratar as mensagens de erro? → A:
  **Preservar verbatim.** As mensagens (ex.: "sent to Meta but DB insert
  failed", "contact not found for this account", "WhatsApp not configured for
  this account", "contact phone invalid") são preservadas literalmente, por
  serem comportamento observável via os logs dos motores. É requisito testável.

## Cenários de Usuário & Testes *(obrigatório)*

### User Story 1 - Nenhuma regressão nos dois motores (Priority: P1)

Um operador tem, na conta, tanto um **chatbot** (flow com menu de botões,
coleta de dados e handoff) quanto **regras de CRM** (automação que, ao receber
mensagem, cria deal, atribui agente e dispara webhook). Depois deste refactor,
os dois continuam funcionando **exatamente** como antes — mesmas mensagens,
mesma ordem, mesma aparência na inbox.

**Por que esta prioridade**: é a razão de o refactor ser seguro. Se qualquer
comportamento observável mudar, o refactor falhou. Tudo o mais depende disso.

**Teste independente**: disparar um flow completo (send_message, send_buttons,
send_list, send_media, collect_input, handoff) e uma automação completa
(send_message, send_template, send_buttons/list) antes e depois, e comparar: a
mensagem entregue, a linha em `messages` (incluindo `sender_type='bot'`,
`ai_generated`, `interactive_payload`) e a atualização da conversa devem ser
idênticas.

**Acceptance Scenarios**:

1. **Given** um flow ativo com nós de texto, mídia, botões, lista e coleta de
   entrada, **When** um contato o dispara, **Then** cada mensagem é entregue e
   persistida idêntica ao comportamento anterior (mesmo `content_type`,
   `sender_type='bot'`, `interactive_payload` quando aplicável).
2. **Given** uma automação com passos send_message, send_template e
   send_buttons/list, **When** o trigger dispara, **Then** as mensagens são
   entregues e persistidas idênticas ao comportamento anterior.
3. **Given** um contato cujo telefone precisa da variante com/sem "0" de tronco,
   **When** um motor envia, **Then** o retry por variante de telefone continua
   funcionando e o telefone corrigido é salvo no contato, como antes.
4. **Given** o auto-reply de IA habilitado, **When** ele envia uma resposta,
   **Then** a mensagem é persistida com `ai_generated = true`, como antes.
5. **Given** uma mensagem de entrada consumida por um flow, **When** o webhook
   processa, **Then** a precedência flows > automations > IA permanece intacta.

---

### User Story 2 - Resolução de número em um único ponto (Priority: P1)

O time da Fnx precisa que o envio dos motores esteja pronto para **múltiplos
números por conta** (funcionalidade futura). Hoje a resolução do
`whatsapp_config` está repetida em ~4 lugares, cada um com `.single()` por
`account_id` — o que quebra quando existem N números. Depois deste refactor,
essa resolução vive em **um único ponto (costura)**, de forma que a futura
funcionalidade de múltiplos números altere apenas esse ponto.

**Por que esta prioridade**: é o retorno estratégico do refactor. Fazê-lo agora
transforma a futura spec de múltiplos números de "mudar 4+ lugares" em "mudar 1
lugar". É o que o Princípio IV (mudança dirigida por spec, uma decisão de
arquitetura por vez) recomenda preparar.

**Teste independente**: verificar que ambos os motores obtêm o
`whatsapp_config` por meio de uma única função/costura, e que essa costura
aceita a config já resolvida (ou um resolvedor) em vez de embutir o `.single()`.

**Acceptance Scenarios**:

1. **Given** o envio de qualquer um dos motores, **When** ele precisa do número
   de WhatsApp, **Then** a resolução acontece por meio de uma única costura
   compartilhada, não de cópias por arquivo.
2. **Given** a costura de resolução de config, **When** um futuro trabalho de
   múltiplos números precisar resolver o número por conversa em vez de por
   conta, **Then** essa mudança é feita em **um** ponto e ambos os motores a
   herdam.

---

### User Story 3 - Um único ponto de envio dos motores (Priority: P2)

O time da Fnx mantém o produto com três pessoas. Hoje a mesma sequência de
envio (carregar contato, carregar config, retry por telefone, persistir
mensagem, atualizar conversa) está copiada em `automations/meta-send.ts` e
`flows/meta-send.ts`. Depois deste refactor, essa sequência existe **uma vez**,
e os dois motores são adaptadores finos sobre ela.

**Por que esta prioridade**: reduz custo de manutenção e a chance de as cópias
divergirem (um bug corrigido num arquivo e esquecido no outro). É o Princípio
VII (manutenibilidade para time pequeno). Prioridade P2 porque o valor de
segurança (US1) e o estratégico (US2) vêm primeiro; a limpeza é a consequência.

**Teste independente**: inspecionar que não há mais duas cópias da sequência de
envio; ambos os motores chamam a base compartilhada. A suíte de testes dos dois
motores permanece verde, e a base compartilhada ganha seus próprios testes.

**Acceptance Scenarios**:

1. **Given** o código dos dois motores, **When** revisado, **Then** a sequência
   de envio (contato → config → retry → persistência → atualização de conversa)
   aparece em um único módulo compartilhado, e não duplicada.
2. **Given** os senders interativos (botões/lista), que hoje já são
   compartilhados entre os motores, **When** o refactor termina, **Then** eles
   passam pela mesma base compartilhada, sem uma segunda cópia.

---

### Edge Cases

- **Contato de outra conta**: o filtro por `account_id` nas queries (defesa em
  profundidade sobre o client `service_role`, que ignora RLS) DEVE ser
  preservado. Um motor NÃO pode enviar para o telefone de um contato de outra
  conta. (Constitution, Princípio II.)
- **WhatsApp não configurado**: se a conta não tem `whatsapp_config`, o envio
  falha com erro claro, como hoje — sem exceção não tratada.
- **Meta aceita mas o INSERT em `messages` falha**: o comportamento atual
  (registrar o erro sem fingir que o envio falhou, já que a Meta recebeu) DEVE
  ser mantido.
- **Todas as variantes de telefone rejeitadas**: o último erro é propagado, como
  hoje.
- **Envio de mídia sem legenda**: o preview da conversa continua usando o
  fallback `[image]/[video]/[document]`, como hoje.

## Requisitos *(obrigatório)*

### Functional Requirements

- **FR-001**: O sistema DEVE preservar comportamento observável idêntico ao
  atual para todo envio originado dos motores automations e flows (mensagem
  entregue, linha em `messages`, atualização da conversa).
- **FR-002**: O sistema DEVE manter os **dois** paradigmas — chatbot
  conversacional (flows) e regras de automação de CRM (automations). Nenhum é
  removido ou fundido no outro.
- **FR-003**: A sequência de envio dos motores (carregar contato por
  `account_id`; carregar `whatsapp_config`; descriptografar o `access_token`;
  retry por variante de telefone; inserir em `messages` com `sender_type='bot'`;
  atualizar a conversa) DEVE existir em um único módulo compartilhado, não
  duplicada por motor.
- **FR-004**: A resolução do `whatsapp_config` DEVE ser uma costura única — a
  base compartilhada recebe a config já resolvida OU um resolvedor de config, em
  vez de embutir o `.single()` por `account_id` em cada chamada.
- **FR-005**: O sistema DEVE preservar o filtro por `account_id` em todas as
  queries de contato e config (defesa em profundidade sobre o client
  `service_role`).
- **FR-006**: O sistema DEVE preservar os campos específicos de cada mensagem:
  `sender_type='bot'`, `ai_generated` (auto-reply de IA), `interactive_payload`
  (botões/lista), `content_type` por tipo, e o texto de preview da conversa.
- **FR-007**: O sistema DEVE preservar o retry por variante de telefone
  (`phoneVariants` + detecção de "recipient not allowed") e a correção do
  telefone no contato quando uma variante funciona.
- **FR-008**: O sistema DEVE preservar a precedência do webhook: flows consome
  primeiro; automations de conteúdo e auto-reply de IA são suprimidos quando um
  flow consumiu a mensagem.
- **FR-009**: A mudança DEVE ser aditiva e de baixo risco de conflito com o
  upstream: um novo módulo compartilhado, com os dois `meta-send.ts` reescritos
  como adaptadores finos sobre ele. (Constitution, Princípio V.)
- **FR-010**: Os testes existentes dos dois motores DEVEM permanecer verdes, e a
  base compartilhada DEVE ganhar cobertura de testes própria.
- **FR-011**: A base `sendFromEngine` NÃO DEVE receber nem gravar `userId`
  (autor). Os adaptadores mantêm `userId` em suas assinaturas públicas mas o
  ignoram — comportamento idêntico ao atual. (Atribuição de autor é escopo da
  futura spec de Auditoria.)
- **FR-012**: As mensagens de erro lançadas pela base DEVEM ser idênticas às
  atuais (verbatim), pois alimentam os logs dos motores
  (`automation_logs`/`flow_run_events`). Cobrir por teste.

### Key Entities *(inclui dados)*

- **Base de envio dos motores**: a sequência única e parametrizada de envio +
  persistência usada por ambos os motores. Parâmetros de variação: a chamada
  específica da Meta API e a forma da linha de `messages`.
- **Costura de resolução de config**: o ponto único que resolve qual
  `whatsapp_config` (número) usar para um envio. Hoje resolve por `account_id`;
  desenhada para, no futuro, resolver por conversa/número sem tocar nos motores.
- **Adaptador de motor**: a camada fina, por motor, que traduz a intenção do
  passo (send_message, send_template, send_buttons, send_list, send_media) em uma
  chamada à base compartilhada.

## Success Criteria *(obrigatório)*

### Measurable Outcomes

- **SC-001**: 100% dos cenários de envio dos dois motores produzem mensagem
  entregue, linha em `messages` e atualização de conversa **idênticas** ao
  comportamento anterior (verificável por testes de comportamento).
- **SC-002**: A sequência de envio dos motores aparece em **exatamente um**
  módulo compartilhado (zero cópias duplicadas entre `automations` e `flows`).
- **SC-003**: A resolução do número de WhatsApp acontece em **um único** ponto;
  uma mudança hipotética "resolver por conversa em vez de por conta" tocaria
  **1** lugar, não 4+.
- **SC-004**: A suíte de testes permanece 100% verde, e a base compartilhada tem
  cobertura de testes própria cobrindo: retry por telefone, filtro de
  `account_id`, falha de INSERT pós-envio, e os campos por tipo de mensagem.
- **SC-005**: Nenhuma mudança em migrations de banco nem em UI dos builders
  (a mudança é interna à camada de envio).

## Assumptions

- O core de envio do usuário (`send-message.ts` / `meta-api.ts`) permanece a
  referência de comportamento; convergir os motores com ele é desejável onde
  seguro, mas o foco desta spec é a base compartilhada **entre os dois motores**,
  não reescrever o caminho de envio manual do usuário.
- `templates.ts` e `validate.ts` de cada motor **não** são consolidados — são
  específicos de cada paradigma (dados de seed e schemas diferentes).
- Nenhuma tabela nova nem alteração de schema é necessária para este refactor.
- A funcionalidade de múltiplos números é uma spec separada
  (`docs/spec-multi-numero.md`); esta apenas prepara a costura que a torna
  barata.
- O ambiente é o já montado: Next.js + Supabase; motores rodam com client
  `service_role`.

## Dependencies

- **Habilita** (não bloqueia) a futura spec de múltiplos números por conta: a
  costura de resolução de config (FR-004) é o ponto que aquela spec vai alterar.
- Governada pela Constitution do projeto (`.specify/memory/constitution.md`),
  em especial os Princípios II (segurança/`service_role`), V (disciplina de
  upstream) e VII (manutenibilidade).
