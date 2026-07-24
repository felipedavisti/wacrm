# Especificação de Feature: Observabilidade e Operação

**Feature Branch**: autoria em `009-motor-nucleo`; implementação em branch própria.

**Created**: 2026-07-24

**Status**: Draft

**Input**: Discussão com o PO em 2026-07-24 sobre "garantia de que tudo será
entregue e nada perdido", somada à auditoria de escala horizontal do mesmo dia.
A pergunta que originou tudo: *como saber que está funcionando, sem alguém
olhando?*

## Contexto e Problema

O motor de leads tem garantias fortes **depois** que o evento entra: bruto
gravado antes de qualquer decisão, idempotência, reivindicação atômica, backoff,
falha visível e reprocessável. Isso foi construído e validado com tráfego real.

O que **não** existe é a capacidade de perceber que algo parou. Concretamente:

- **Nada expõe se o worker está vivo.** Ele loga na inicialização e depois só
  quando há trabalho. Um laço morto por exceção, ou uma instância onde a
  variável de ambiente não foi injetada, é **indistinguível de uma instância
  saudável e ociosa**. Com N instâncias e config drift, é o modo de falha mais
  provável de todos.
- **Não há endpoint de saúde.** O balanceador só pode sondar rotas que passam
  pelo middleware e chamam o Auth do Supabase a cada sonda — o que cria um modo
  de falha novo: Auth lento derruba **todas** as instâncias do pool ao mesmo
  tempo.
- **284 chamadas de log em texto livre**, sem identificador de correlação, sem
  identificador de instância, sem medição de duração. "Qual instância atendeu
  isto e quanto demorou?" é hoje impossível de responder.
- **A tabela de eventos rejeitados não tem tela.** Assinatura inválida e token
  errado vão para lá — e ali moram duas coisas muito diferentes: configuração
  quebrada e alguém tentando forjar lead.
- **Ninguém é avisado de nada.** Toda a visibilidade exige abrir o painel.
  Falha de sábado à noite espera até segunda.

E há um buraco de borda que o PO identificou na discussão: o espelho do n8n usa
"não derrubar produção" como regra, o que significa que **se o CRM estiver fora,
o lead nunca existe para nós e não há registro em lugar nenhum**. A garantia de
"nada se perde" começa na nossa porta, não antes dela.

## Clarifications

### Session 2026-07-24

- Q: Observabilidade completa (traces, métricas, APM) ou o mínimo que evita as
  falhas silenciosas? → A: **o mínimo com maior retorno.** O critério é: cobrir
  primeiro as falhas que **parecem sucesso**. Ferramenta externa de APM fica
  para quando houver dor que a justifique.
- Q: Alertar por qual canal? → A: **em aberto.** Existe WhatsApp e n8n na casa;
  a decisão fica para o plano. O requisito é que o alerta **saia do sistema**,
  não que seja um canal específico.
- Q: Reconciliação para leads de site? → A: **não há fonte da verdade externa**
  para comparar, diferente da Meta. O caminho é o próprio espelho registrar o
  que tentou enviar — do lado do n8n.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Saber que o worker está vivo (Priority: P1)

Como operação, quero ver que a entrega automática está rodando, para descobrir
que ela parou em minutos e não quando um vendedor reclamar que não recebe lead
há dois dias.

**Why this priority**: é a falha que **engana**. Se o laço morre, os leads
empilham em "Na fila" e a tela continua bonita — sem erro, sem vermelho, sem
nada. Todas as outras falhas do motor já são visíveis; esta não.

**Independent Test**: matar o laço, esperar o limite, e verificar que a
interface passa a sinalizar. Religar e verificar que volta ao normal.

**Acceptance Scenarios**:

1. **Given** o worker rodando, **When** o operador abre o painel, **Then** vê
   quando foi a última rodada bem-sucedida.
2. **Given** nenhuma rodada além do limite configurado, **When** o painel é
   aberto, **Then** há sinalização inequívoca de que a entrega está parada.
3. **Given** N instâncias, **When** só algumas rodam o laço, **Then** isso é
   visível — não basta "alguém rodou".
4. **Given** um tique que falhou ao reivindicar, **When** ele retorna zero,
   **Then** isso se distingue de "não havia trabalho" (hoje são idênticos).

---

### User Story 2 — Balanceador saber se a instância serve (Priority: P1)

Como infraestrutura, quero uma sonda barata e honesta de saúde, para tirar do
ar a instância certa sem derrubar as saudáveis junto.

**Why this priority**: bloqueia a escala horizontal. Sem isso, o balanceador
sonda uma rota qualquer, que chama o Auth do Supabase a cada verificação — e um
Auth lento tira **todas** as instâncias do pool simultaneamente. A sonda vira a
causa da indisponibilidade que deveria evitar.

**Independent Test**: chamar o endpoint com o Auth do Supabase indisponível e
verificar que ele responde. Depois com o Postgres indisponível e verificar que
ele **não** responde saudável.

**Acceptance Scenarios**:

1. **Given** o endpoint de saúde, **When** é chamado, **Then** não passa pelo
   middleware de sessão nem chama o Auth.
2. **Given** o banco inacessível, **When** a sonda roda, **Then** a instância é
   reportada como não saudável.
3. **Given** a resposta, **When** lida por um humano, **Then** identifica a
   instância e o estado do worker de background.
4. **Given** o endpoint público, **When** chamado por qualquer um, **Then** não
   vaza segredo, versão de dependência, nem dado de cliente.

---

### User Story 3 — Rastrear um evento de ponta a ponta (Priority: P1)

Como quem investiga um problema, quero seguir um evento desde a chegada até o
negócio criado, para não depender de grep em texto de N instâncias intercaladas.

**Why this priority**: hoje um "lead sumiu" exige correlacionar o log da Meta
com 284 linhas de texto livre de N processos, sem nenhuma chave. É a diferença
entre diagnosticar em minutos e em uma tarde.

**Independent Test**: processar um evento e recuperar toda a sua trilha por um
único identificador.

**Acceptance Scenarios**:

1. **Given** uma requisição, **When** entra no sistema, **Then** recebe um
   identificador de correlação que acompanha todo o processamento — inclusive o
   trabalho assíncrono disparado por ela.
2. **Given** um registro de log, **When** lido, **Then** identifica a instância
   que o produziu.
3. **Given** o trabalho assíncrono, **When** termina, **Then** há registro de
   conclusão — hoje o único sinal é a ausência de erro.

---

### User Story 4 — Ver o que foi recusado (Priority: P2)

Como responsável, quero ver os eventos que foram rejeitados na porta, para
distinguir "minha configuração quebrou" de "alguém está tentando forjar lead".

**Why this priority**: a tabela existe e é populada desde a 009; falta a tela.
Custo baixo, e cobre uma superfície de segurança que hoje é cega.

**Independent Test**: gerar uma rejeição por token inválido e outra por
assinatura inválida, e ver as duas na interface com o motivo.

**Acceptance Scenarios**:

1. **Given** eventos rejeitados, **When** o responsável abre a tela, **Then** vê
   origem, motivo, momento e o que foi tentado.
2. **Given** o payload rejeitado, **When** exibido, **Then** respeita a LGPD —
   não é vitrine de dado pessoal de terceiro (Constituição I).
3. **Given** um pico de rejeições, **When** acontece, **Then** é distinguível de
   ruído normal.

---

### User Story 5 — Ser avisado sem abrir a tela (Priority: P2)

Como responsável pela operação, quero ser avisado quando algo estiver errado,
para não depender de rotina de conferência humana.

**Why this priority**: é o que transforma observabilidade em operação. Mas
depende das três primeiras existirem — alertar sobre sinal que não existe é
impossível.

**Independent Test**: provocar cada condição de alerta e verificar que a
notificação sai.

**Acceptance Scenarios**:

1. **Given** o worker parado além do limite, **When** detectado, **Then** um
   alerta sai do sistema.
2. **Given** falhas de entrega acima do normal, **When** detectado, **Then**
   alerta.
3. **Given** a mesma condição persistindo, **When** o tempo passa, **Then** não
   há enxurrada de alertas repetidos — agrupamento, como nos alertas de formato
   da 011.
4. **Given** a condição normalizada, **When** acontece, **Then** há sinal de
   recuperação — senão ninguém sabe se ainda está quebrado.

---

### User Story 6 — Saber quanto tempo leva (Priority: P3)

Como PO, quero saber quanto tempo passa entre o lead chegar e virar negócio no
funil, para saber se a promessa de "atendimento rápido" se sustenta.

**Why this priority**: é métrica de produto, não de falha. Vale quando a
operação já estiver estável.

**Acceptance Scenarios**:

1. **Given** leads entregues, **When** o painel é aberto, **Then** mostra o
   tempo típico entre chegada e negócio criado.
2. **Given** uma degradação, **When** o tempo cresce, **Then** é perceptível
   antes de virar reclamação.

---

### Edge Cases

- **Alerta sobre o sistema que está fora**: se o alerta depende do CRM,
  o CRM caído não avisa. O canal precisa ser minimamente independente.
- **Relógios diferentes** entre instâncias afetando "última rodada há X".
- **Instância recém-subida** ainda sem primeiro tique, que não deve parecer
  quebrada.
- **Múltiplas instâncias**: "última rodada" é do deployment ou de cada uma? O
  cenário de config drift (uma instância sem a variável) exige a segunda
  leitura.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-058**: O worker DEVE registrar de forma persistente e consultável o
  momento e o resultado da última rodada, por instância.
- **FR-059**: A interface de operação DEVE exibir o estado da entrega
  automática e sinalizar quando não houver rodada dentro do limite esperado.
- **FR-060**: Um tique que falhou ao reivindicar DEVE ser distinguível de um
  tique sem trabalho.
- **FR-061**: DEVE existir endpoint de saúde que **não** passe pelo middleware
  de sessão nem chame o serviço de autenticação.
- **FR-062**: O endpoint de saúde DEVE refletir a capacidade real de trabalhar
  (acesso ao banco), não apenas que o processo responde.
- **FR-063**: O endpoint de saúde DEVE identificar a instância e o estado do
  worker, sem expor segredo nem dado de cliente.
- **FR-064**: Toda requisição DEVE receber um identificador de correlação,
  propagado ao trabalho assíncrono que ela disparar.
- **FR-065**: Todo registro de log do servidor DEVE identificar a instância.
- **FR-066**: Os eventos rejeitados na porta DEVEM ter tela, com origem, motivo
  e momento, respeitando a LGPD no que for exibido do payload.
- **FR-067**: O sistema DEVE emitir alerta para fora quando a entrega parar ou
  a taxa de falha subir, com agrupamento contra enxurrada e sinal de
  recuperação.
- **FR-068**: A latência entre chegada e entrega DEVE ser mensurável.
- **FR-069**: A instrumentação NÃO PODE alterar o comportamento do caminho
  principal: falha ao registrar telemetria nunca derruba uma entrega.

### Key Entities

- **Heartbeat de instância**: última rodada, resultado, identificador.
- **Evento rejeitado**: já existe (`lead_rejected_events`); ganha superfície.
- **Alerta**: condição, primeira e última ocorrência, contagem, estado de
  recuperação — mesmo formato dos alertas de formato da 011.

## Success Criteria *(mandatory)*

- **SC-OBS-1**: Worker parado é percebido em minutos, sem ninguém conferir.
- **SC-OBS-2**: O balanceador distingue instância saudável de doente sem
  depender do serviço de autenticação.
- **SC-OBS-3**: Um evento é rastreável de ponta a ponta por um identificador.
- **SC-OBS-4**: Uma instância sem a configuração do worker é detectável.
- **SC-OBS-5**: Rejeição na porta é visível sem consultar o banco.
- **SC-OBS-6**: Nenhuma falha de telemetria derruba uma entrega.

## Assumptions

- Não haverá ferramenta externa de APM nesta fase. Se aparecer, o identificador
  de correlação e os logs estruturados são pré-requisito dela — nada aqui se
  perde.
- Os registros de negócio que já existem (`flow_run_events`, `automation_logs`,
  `lead_recovery_runs`, histórico de tentativas de entrega) são trilha de
  domínio, não telemetria. Complementam, não substituem.
- O alerta pode reusar a infraestrutura de WhatsApp que a casa já tem.

## Fora de Escopo

- **Correção sob concorrência** — spec 012.
- APM, tracing distribuído, painel de métricas de infraestrutura.
- Auditoria de acesso para LGPD ("quem leu o dado do cliente") — segue sendo
  necessidade futura separada, conscientemente fora de escopo desde a 003.
- Fechar o buraco do espelho do n8n **do lado do n8n** — é trabalho no fluxo
  deles, não no CRM. Esta spec só garante que o nosso lado seja observável.

## Dependências

- **009** (motor de leads — o worker e o painel a instrumentar).
- **012** recomendada antes ou em paralelo: várias condições de alerta só fazem
  sentido depois que as corridas estiverem corrigidas.
