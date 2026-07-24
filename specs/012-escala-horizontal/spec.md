# Especificação de Feature: Prontidão para Escala Horizontal

**Feature Branch**: autoria em `009-motor-nucleo`; implementação em branch própria.

**Created**: 2026-07-24

**Status**: Draft

**Input**: Auditoria de código feita em 2026-07-24, motivada pela decisão do
PO de escalar horizontalmente (N instâncias atrás de load balancer). Só entram
aqui achados **verificados no código**, não boas práticas genéricas.

## Contexto e Problema

Hoje o CRM roda em **uma** instância (`next start`, atrás de Cloudflare). Vários
pontos do código assumem isso — alguns explicitamente documentados, outros não.
Subir para N instâncias sem tratá-los produz três classes de dano:

1. **Dado errado que ninguém percebe** — contadores que se perdem em corrida.
2. **Efeito visível para o cliente final** — mensagem duplicada no WhatsApp.
3. **Limite de uso que deixa de limitar** — custo e risco de 429 do provedor.

A auditoria encontrou **quatro** padrões de leitura-modificação-escrita não
atômicos, um limitador de uso por processo, e a ausência total de desligamento
gracioso. O mais perigoso é o de flows: o comentário no código **afirma
atomicidade que não existe**.

Esta spec cobre **correção sob concorrência**. A capacidade de *enxergar* o que
está acontecendo com N instâncias é a spec 013.

## Clarifications

### Session 2026-07-24

- Q: Corrigir tudo antes de escalar, ou escalar e corrigir sob pressão? → A:
  **Antes.** A decisão do PO foi explícita: "quero garantir o excelente agora em
  termos de arquitetura", justamente para não descobrir isso com produção
  quebrando.
- Q: Trocar o limitador em memória por qual infraestrutura? → A: **em aberto**
  (Redis/Upstash/Postgres). A interface `RateLimitResult` já foi desenhada para
  a troca; os 16 pontos de chamada não mudam. A decisão fica para o plano.
- Q: Contadores — corrigir com RPC atômica ou transação? → A: **RPC**, seguindo
  os quatro exemplos que já existem no repositório
  (`increment_automation_execution_count`, `increment_flow_execution_count`,
  `record_webhook_failure`, `claim_ai_reply_slot`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Fluxo conversacional não responde duas vezes (Priority: P1)

Como cliente que está num fluxo automatizado no WhatsApp, quero receber **uma**
resposta para cada mensagem que envio, mesmo mandando duas em sequência rápida.

**Why this priority**: é o único achado com **efeito direto e visível para o
cliente final**. As outras falhas corrompem dado interno; esta manda mensagem
duplicada para uma pessoa real, e ainda apaga a variável que ela acabou de
informar.

**Independent Test**: disparar duas mensagens do mesmo contato, para o mesmo
`flow_run` ativo, em paralelo (simulando duas instâncias). Verificar que apenas
uma avança o run, que nenhuma variável capturada é perdida, e que o nó seguinte
é enviado **uma** vez.

**Acceptance Scenarios**:

1. **Given** um `flow_run` ativo em nó `collect_input`, **When** duas mensagens
   de texto do mesmo contato são processadas concorrentemente, **Then** as duas
   variáveis capturadas coexistem (nenhuma sobrescreve a outra) e o run avança
   uma única vez.
2. **Given** duas instâncias processando o mesmo run, **When** ambas tentam
   avançar do mesmo `current_node_key`, **Then** só uma vence e a outra registra
   que perdeu a corrida — sem enviar mensagem.
3. **Given** o mesmo `meta_message_id` entregue duas vezes pela Meta em
   instâncias diferentes, **When** ambas checam duplicidade, **Then** apenas uma
   processa (a checagem atual é TOCTOU e não cobre isso).

---

### User Story 2 — Contadores refletem a realidade (Priority: P1)

Como atendente, quero que o número de não lidas mostre quantas mensagens de
fato chegaram, para não deixar cliente sem resposta por confiar num badge
errado.

**Why this priority**: perda **permanente e silenciosa** — nada reconcilia
depois. E contamina o contador global do cabeçalho, não só a conversa.

**Independent Test**: processar N mensagens da mesma conversa em paralelo e
verificar que `unread_count` terminou em N.

**Acceptance Scenarios**:

1. **Given** uma conversa com `unread_count = 0`, **When** três mensagens do
   cliente são processadas concorrentemente, **Then** `unread_count = 3`.
2. **Given** duas execuções pendentes de automação com o mesmo `log_id`,
   **When** são retomadas em instâncias diferentes, **Then** o histórico de
   passos contém os passos das duas — nenhum é sobrescrito.

---

### User Story 3 — Limite de uso protege o cliente, não a instância (Priority: P1)

Como responsável pela conta, quero que o teto de uso valha para a empresa
inteira, independente de quantas instâncias o CRM tenha, para não estourar a
cota do provedor de IA nem pagar por uso que deveria ter sido barrado.

**Why this priority**: com N instâncias o teto vira `limite × N`, em **16
pontos de chamada**. Os dois mais caros (`aiDraftAccount`,
`aiAutoReplyAccount`) existem justamente para proteger a chave BYO do cliente
contra o rate limit do provedor — e são os que mais se degradam.

**Independent Test**: com duas instâncias apontando para o mesmo backend de
contagem, esgotar o limite numa e verificar que a outra também recusa.

**Acceptance Scenarios**:

1. **Given** o limite de N requisições por janela, **When** as chamadas se
   distribuem entre instâncias, **Then** o total aceito na janela é N (não
   `N × instâncias`).
2. **Given** o backend de contagem indisponível, **When** uma requisição
   chega, **Then** o comportamento é decidido explicitamente (fail-open ou
   fail-closed) e documentado — nunca acidental.
3. **Given** a troca de implementação, **When** o código é revisado, **Then**
   nenhum dos 16 pontos de chamada precisou mudar.

---

### User Story 4 — Instância que sai do ar não leva trabalho junto (Priority: P1)

Como operação, quero que um deploy ou uma redução de escala não descarte
trabalho em andamento, para que mensagem de cliente não desapareça durante uma
janela de manutenção.

**Why this priority**: hoje **não existe** tratamento de `SIGTERM` em lugar
nenhum. Todo o processamento de mensagem recebida roda em `after()`, **depois**
de já termos respondido 200 à Meta — que nunca reenvia. Um rolling deploy
descarta silenciosamente o que estiver em voo. É a mesma classe de bug do issue
#301, ressuscitada por outro caminho.

**Independent Test**: enviar um evento, disparar `SIGTERM` durante o
processamento, e verificar que o trabalho ou completou ou é recuperável — nunca
sumiu.

**Acceptance Scenarios**:

1. **Given** trabalho em `after()` em andamento, **When** o processo recebe
   `SIGTERM`, **Then** há uma janela de drenagem antes do encerramento.
2. **Given** uma execução de automação reivindicada (`status='running'`),
   **When** a instância morre antes de finalizá-la, **Then** existe mecanismo
   que a recupera — hoje ela fica travada para sempre.
3. **Given** um envio de campanha interrompido, **When** a instância cai,
   **Then** os destinatários pendentes são recuperáveis e a campanha não fica
   presa em `sending`.

---

### User Story 5 — Status de entrega não anda para trás (Priority: P2)

Como atendente, quero que o tique de "lido" não volte para "entregue", para
poder confiar no que a tela mostra.

**Why this priority**: já era possível com uma instância (concorrência de I/O),
mas a janela era de milissegundos. Com N instâncias e latências independentes,
vira rotina. É P2 porque o dano é cosmético — não perde mensagem.

**Independent Test**: processar `read` e `delivered` fora de ordem e verificar
que o status final é `read`.

**Acceptance Scenarios**:

1. **Given** uma mensagem com status `read`, **When** um evento `delivered`
   chega atrasado, **Then** o status permanece `read`.
2. **Given** a escada de status, **When** qualquer evento é aplicado, **Then**
   só avança — nunca regride (a proteção já existe para campanhas; falta para
   mensagens).

---

### User Story 6 — Evento reentregue não duplica (Priority: P2)

Como atendente, quero não ver a mesma mensagem duas vezes na conversa quando a
Meta reentrega o evento.

**Why this priority**: a Meta reentrega por timeout de rede, e com N instâncias
o retry cai noutra máquina — onde nenhuma checagem em memória ajuda. Além da
duplicata visual, dispara automação duas vezes (**o cliente recebe a resposta
automática em duplicata**) e entrega o webhook de saída duas vezes.

**Independent Test**: entregar o mesmo evento duas vezes em paralelo e
verificar que existe uma linha só.

**Acceptance Scenarios**:

1. **Given** o mesmo evento entregue duas vezes, **When** ambos são
   processados, **Then** existe uma mensagem só e os gatilhos dispararam uma
   vez.
2. **Given** a garantia no banco, **When** duas instâncias tentam inserir,
   **Then** a segunda é absorvida sem erro para o chamador.

---

### Edge Cases

- **Reentrada durante deploy**: instância antiga e nova convivendo por alguns
  segundos, com versões diferentes do mesmo código.
- **Relógios diferentes** entre instâncias afetando janelas (24h, rate limit).
- **Rotação de segredo**: os clientes `service_role` são criados uma vez por
  processo — trocar a chave exige reiniciar todas as instâncias, sem
  invalidação. Precisa de procedimento, não necessariamente de código.
- **PIDs colidem entre containers**: `locked_by` do worker usa `process.pid` e
  deixa de identificar a instância.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-048**: Toda atualização de contador ou de estrutura acumulada (não
  lidas, variáveis de fluxo, histórico de passos) DEVE ser atômica no banco —
  RPC ou expressão SQL —, nunca calculada na aplicação a partir de uma leitura
  anterior.
- **FR-049**: O processamento de uma resposta em fluxo ativo DEVE usar
  reivindicação ou comparação-e-troca sobre o nó atual, de forma que duas
  instâncias nunca avancem o mesmo run. O comentário que hoje afirma
  atomicidade DEVE ser corrigido ou tornado verdadeiro.
- **FR-050**: O limitador de uso DEVE contar por identificador **global ao
  deployment**, não por processo. A interface de retorno atual DEVE ser
  preservada para que os pontos de chamada não mudem.
- **FR-051**: O comportamento do limitador quando o backend de contagem está
  indisponível DEVE ser explícito e documentado.
- **FR-052**: O processo DEVE tratar `SIGTERM` com uma janela de drenagem
  compatível com a duração máxima das rotas, antes de encerrar.
- **FR-053**: Trabalho reivindicado por uma instância DEVE ser recuperável se
  ela morrer — por lease com expiração ou equivalente. Aplica-se às execuções
  pendentes de automação, hoje sem recuperação.
- **FR-054**: A escada de status de mensagem DEVE ser monotônica: um evento não
  pode regredir o status já registrado.
- **FR-055**: A ingestão de mensagem recebida DEVE ser idempotente por
  identificador da Meta, com a garantia no **banco** — não na aplicação.
- **FR-056**: Nenhum estado mutável novo pode viver em memória de processo se
  influenciar decisão de negócio. Constante imutável é permitida.
- **FR-057**: Trabalho longo iniciado dentro de uma requisição DEVE ser
  durável ou explicitamente recuperável — não pode depender do processo
  sobreviver.

### Key Entities

- **Execução pendente de automação**: ganha lease e recuperação.
- **Run de fluxo**: ganha reivindicação antes do avanço.
- **Contador de não lidas**: passa a ser incrementado no banco.
- **Bucket de limite de uso**: sai da memória do processo.

## Success Criteria *(mandatory)*

- **SC-ESC-1**: Com N instâncias, N mensagens concorrentes na mesma conversa
  resultam em `unread_count = N`.
- **SC-ESC-2**: Duas respostas concorrentes no mesmo fluxo produzem **uma**
  mensagem de saída e **nenhuma** variável perdida.
- **SC-ESC-3**: O total aceito pelo limitador numa janela é o configurado,
  independente do número de instâncias.
- **SC-ESC-4**: Nenhuma execução de automação fica travada em `running` após
  encerramento de instância.
- **SC-ESC-5**: Reentrega do mesmo evento da Meta não cria segunda mensagem nem
  dispara gatilho duas vezes.
- **SC-ESC-6**: Status de mensagem nunca regride, sob qualquer ordem de
  chegada.

## Assumptions

- O deploy continua sendo processo Node de longa duração (`next start`), não
  serverless. Se mudar, FR-052 e o laço em processo perdem sentido e o caminho
  passa a ser o agendador externo.
- O worker de leads **já é seguro** para N instâncias (`FOR UPDATE SKIP
  LOCKED`) — é o padrão de referência a seguir nos demais.
- Realtime é responsabilidade do Supabase; os navegadores conectam direto, sem
  passar pelo balanceador. **Não há necessidade de sessão presa a instância.**
- Não há escrita em disco local em nenhum caminho de runtime — verificado.

## Fora de Escopo

- **Observabilidade** — spec 013. Aqui é correção sob concorrência; lá é
  enxergar o que acontece.
- Otimização de desempenho (agregações do dashboard no cliente, ausência de
  cache de mídia). São custo, não correção.
- Migração de destino de entrega, filas externas, ou troca de banco.
- O buraco do espelho do n8n (evento que nunca chega ao CRM porque a perna
  falhou em silêncio) — é resiliência de borda, tratada na 013.

## Dependências

- **009** (motor de leads — fornece o padrão de claim atômico a ser replicado).
- Decisão de infraestrutura para o limitador de uso (Redis/Upstash/Postgres).
