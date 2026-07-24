# Mapa de funcionalidades do wacrm

> Levantamento feito lendo o código em 2026-07-22, na branch `009-motor-nucleo`.
> **Só está aqui o que existe no fonte.** Onde a spec promete algo que o código
> não faz, isso está marcado como lacuna — em particular na seção
> [Funcionalidades aparentes](#funcionalidades-aparentes).

## Visão geral

O wacrm é um **CRM multi-empresa construído em volta do WhatsApp**. Uma
empresa conecta N números da Meta, atende no inbox compartilhado, organiza
contatos e oportunidades num funil, automatiza o atendimento por três motores
distintos (regras, fluxos conversacionais e IA), dispara campanhas por template
e — desde as specs 009/010/011 — captura leads de site, formulários da Meta e
anúncios Click-to-WhatsApp, entregando cada um como negócio no funil.

Stack: Next.js (App Router) + Supabase (Postgres com RLS + Auth + Realtime +
Storage). A **fronteira de autorização é o RLS**, não a aplicação — decisão
registrada na constituição do projeto (Princípio II).

Cinco módulos:

| Módulo | O que resolve |
|---|---|
| [A. Mensageria WhatsApp](#a-mensageria-whatsapp) | Receber e responder no WhatsApp, com templates, campanhas e multi-número |
| [B. Automações, Flows e IA](#b-automações-flows-e-ia) | Responder sem humano — por regra, por fluxo ou por modelo |
| [C. CRM](#c-crm) | Contatos, tags, funil de vendas, indicadores |
| [D. Plataforma](#d-plataforma) | Multi-empresa, papéis, configurações, API pública, segurança |
| [E. Motor de Leads](#e-motor-de-leads) | Capturar leads de fora e transformá-los em negócio |

---

## A. Mensageria WhatsApp

### Inbox

Lista de conversas com filtro por situação (todas / não lidas / aberta /
pendente / fechada), por tag e por empresa do contato. Atribuição a um agente
com indicador de presença ao vivo. Contador de não lidas. Deep link
`/inbox?c=<id>` usado pela ficha do contato, pelo dashboard e pelo painel de
leads.

Atualização em tempo real via Supabase Realtime, com duas redes de segurança
contra eventos perdidos: ressincronização ao reconectar o WebSocket e ao
voltar o foco da aba.

**Limites reais**: a lista carrega **sem paginação** (traz tudo que o RLS
permite) e a **busca é client-side** — procura em nome, telefone e na prévia da
última mensagem, mas **não dentro do corpo das mensagens**.

### Mensagens

**Recebe**: texto, imagem, vídeo, documento, áudio, figurinha (tratada como
imagem), localização (como texto), resposta a botão/lista, reação e citação.
Não trata vCard, pedidos, nem mensagens editadas/apagadas — caem num fallback
`[Unsupported message type]`.

**Envia**: texto, mídia (imagem/vídeo/documento/áudio), template, botões (≤3),
listas (≤10 linhas), reações e citações. Não envia localização, figurinha nem
contatos.

O composer tem gravação de **áudio no navegador** (Ogg/Opus), anexos com
legenda, construtor de mensagem interativa e um botão de **rascunho por IA**
que preenche o campo sem enviar.

**Escada de status**: `sending → sent → delivered → read`, com `failed` como
ramo terminal. O espelhamento resolve a conta pelo `phone_number_id` (único),
porque o ID de mensagem da Meta **não é único entre contas** — sem esse
escopo, um tenant alterava a mensagem de outro.

### Templates

Ciclo completo: criar, submeter à Meta, editar (reenvia para aprovação),
excluir e **sincronizar** o que já existe no WhatsApp Manager. Status guardados
verbatim (`APPROVED`, `PENDING`, `REJECTED`, `PAUSED`, `DISABLED`, `IN_APPEAL`,
`PENDING_DELETION`, `DRAFT`).

O seletor de template no inbox só mostra os **aprovados** e coleta as variáveis
de corpo, de cabeçalho e de botão com URL dinâmica, com pré-visualização ao
vivo.

Templates de categoria **AUTHENTICATION não podem ser criados aqui** — a UI
orienta criá-los no WhatsApp Manager e usar o sync.

### Janela de 24 horas

Regra da Meta: fora de 24h da última mensagem do cliente, só template.

Rastreada em `conversations.last_inbound_at`, alimentada pelo webhook com o
timestamp **da própria mensagem do cliente**. A janela é validada **no servidor
antes de chamar a Meta**, com um backstop que traduz o erro 131047 da Meta para
o mesmo estado. No inbox aparece um relógio com o tempo restante e, expirada,
o composer é desabilitado com atalho para os templates.

**Lacuna**: os motores (automações, flows, IA) **não checam a janela** — texto
livre disparado fora das 24h recebe o erro cru da Meta.

### Multi-número (spec 007)

Modelo fiel à Meta: **App → WABA → número**. O `app_secret` vive em `meta_apps`
(por conta, criptografado), porque pertence ao App e não ao número.

Cada conversa é carimbada com o número que a originou, então **o mesmo contato
falando em dois números abre duas threads**. A saída resolve o número pela
conversa; em saída fria, o usuário escolhe (o seletor só aparece com ≥2
números).

**Dívida documentada**: vários caminhos ainda usam "o primeiro número da conta"
— proxy de mídia, reações, sync e submit de template, broadcast pela API
pública. Está registrado no código como refinamento posterior.

### Campanhas (broadcasts)

Assistente de 4 passos: template → audiência (todos / por tags / por campo
personalizado / CSV, com **lista de exclusão** por tag) → personalização das
variáveis → envio.

Os contadores agregados (enviadas, entregues, lidas, respondidas, falhas) são
**propriedade de um trigger no banco**, derivados dos destinatários — o código
deliberadamente não escreve essas colunas.

Página de detalhe com funil visual, tabela de destinatários filtrável e
**exportação CSV**.

**Limites importantes**: o envio pelo dashboard é orquestrado **no navegador** —
fechar a aba interrompe a campanha. Não há retry de destinatário que falhou.
E **agendamento não existe** (ver [Funcionalidades aparentes](#funcionalidades-aparentes)).

### Respostas rápidas

Snippets de texto ou de mensagem interativa, inseridos pelo menu `+` do
composer.

**Lacuna**: não há tela de gestão (editar/excluir/ordenar), e **não é possível
criar um snippet de texto puro pela interface** — só interativos, a partir do
construtor. Texto puro exige chamar a API direto.

---

## B. Automações, Flows e IA

Três motores reagem à mensagem recebida, com **precedência explícita**:

```
Flow ativo  →  Automações  →  IA
```

Quem consome a mensagem primeiro cala os de baixo. Os gatilhos de
relacionamento (`new_contact_created`, `first_inbound_message`) são ortogonais
e disparam sempre.

### Automações

Regras "gatilho → lista de passos", com ramificação binária e passo de espera.

**Gatilhos que funcionam**: `new_message_received`, `first_inbound_message`,
`keyword_match` (exato ou contém, com/sem caixa), `interactive_reply` (por ID
de botão), `new_contact_created`, `tag_added`.

**Ações**: enviar mensagem / botões / lista / template, adicionar e remover
tag, atribuir conversa, atualizar campo do contato, criar negócio, esperar,
condição, chamar webhook (com proteção contra SSRF), encerrar conversa.

**Condições**: presença de tag, campo do contato, conteúdo da mensagem, faixa
de horário.

A espera suspende a execução numa tabela de pendências, drenada por
`GET /api/automations/cron` (segredo compartilhado, até 50 por rodada).

### Flows

Diferente da automação: um **grafo com estado por contato**, que **suspende
esperando a resposta do cliente**.

Tipos de nó implementados: `start`, `send_message`, `send_media`,
`send_buttons`, `send_list`, `collect_input`, `condition`, `set_tag`,
`handoff`, `end`.

Proteções de concorrência levadas a sério: idempotência por ID de mensagem da
Meta, atualização otimista do nó atual, e índice único garantindo **uma run
ativa por contato**.

**Política de fallback** configurável para resposta não reconhecida: repetir a
pergunta (com limite), escalar para humano, ou ignorar — e "ignorar" devolve a
mensagem para as automações e a IA tentarem.

Um agente respondendo manualmente **pausa a run** automaticamente.

Validação bloqueia ativação de fluxo quebrado (aresta sem destino, limite da
Meta estourado, nó de entrada inexistente).

### IA

Modelo próprio da empresa (**BYO key**), OpenAI ou Anthropic, com chave
criptografada. Uma configuração por empresa.

**Resposta automática** com múltiplos freios: desligada por padrão, teto de
respostas por conversa (1–20, padrão 3), silencia quando um humano assume a
conversa, e o modelo pode escalar sozinho emitindo um marcador de handoff — que
gera um resumo determinístico e trava o bot naquela thread.

**Base de conhecimento** com busca semântica (embeddings) e textual, usada para
fundamentar as respostas. Se a chave de embeddings falhar, degrada para busca
textual em vez de quebrar.

**Playground** para testar antes de publicar, e um painel de **consumo em
tokens** (por modo, por modelo, série diária).

O prompt tem defesa explícita contra injeção — trata o conteúdo do cliente como
não confiável.

**Limite**: o consumo é medido em **tokens, não em dinheiro** — não há tabela de
preços nem custo em moeda.

---

## C. CRM

### Contatos

Quatro caminhos de criação: manual, **importação CSV**, webhook do WhatsApp e
API pública / motor de leads.

**Deduplicação** por telefone normalizado, com um detalhe deliberado: o banco
tem índice único por dígitos exatos, mas a aplicação também casa pelos
**últimos 8 dígitos** (tolerância a prefixo). No formulário isso vira aviso
âmbar; nos caminhos automáticos, reaproveita o contato existente.

A ficha do contato tem 6 abas: dados, **conversas** (uma por número, spec 004),
tags, notas, campos personalizados e negócios. Envia template direto da ficha.

Há uma função de banco para **fundir contatos duplicados** históricos,
repontando conversas, negócios, notas, tags e execuções.

### Tags

Por empresa, com nome e cor. Aplicadas manualmente, por importação, por
automação/flow e pelo motor de leads.

As **tags de origem** (spec 010) têm `slug` estável e `is_system`: não podem ser
excluídas nem ter a identidade alterada, mas o nome é livre. É o gancho para o
roteamento de agente por tipo de lead.

### Funil

Múltiplos funis por empresa, com estágios ordenáveis e coloridos.
Arrastar-e-soltar entre colunas (com suporte a teclado). Negócio tem título,
contato, valor + moeda, data prevista, responsável, situação (aberto/ganho/
perdido) e **rastreamento de origem** — a campanha que gerou o lead, exibida
como selo no card e bloco no detalhe.

Analytics do funil: total, valor, ticket médio, **valor ponderado** e
ganhos/perdidos no mês.

### Dashboard

Quatro indicadores (conversas ativas, contatos novos hoje, valor em aberto,
mensagens enviadas hoje), gráfico de mensagens por dia, rosca do funil, tempo
de resposta por dia da semana e um feed de atividade que funde cinco fontes.

### Notificações e presença

Notificação **de um único tipo**: conversa atribuída a você. Em tempo real,
com marcação de lida e navegação para a conversa.

Presença por batimento a cada 30s, com `online` / `ausente` / `offline`
derivado por inatividade. Usada no roster e no seletor de atribuição.

---

## D. Plataforma

### Autenticação e multi-empresa (spec 008)

Cadastro por e-mail e senha. **O cadastro não cria empresa** — cria apenas o
perfil. A empresa vem por provisionamento da TI ou por aceitar um convite.

Pertença é N-para-N (`account_members`): um usuário pode pertencer a várias
empresas com papéis diferentes. `profiles.account_id` virou o **ponteiro da
empresa ativa**.

O **seletor de empresa** aparece só com ≥2 empresas e faz recarga completa da
página ao trocar — regra de "zero resíduo", porque o app busca dados por
componente e não tem cache compartilhado.

Convites com token de uso único (hash no banco, texto puro mostrado uma vez),
expiração configurável, e tela de aceite que **não resgata automaticamente** — o
convidado confirma qual empresa e papel está aceitando.

Todas as mutações de pertença passam por funções de banco com verificação
própria: trocar papel, trocar cargo, remover membro, transferir propriedade
(troca owner↔admin na mesma transação, nunca ficando sem owner).

#### `is_account_member` vs `is_active_member`

Vale entender, porque é a espinha do isolamento:

- **`is_account_member`** — "tenho vínculo nesta empresa". Usada nas superfícies
  de **pertença**: o seletor precisa listar todas as empresas do usuário.
- **`is_active_member`** — "tenho vínculo **e** esta é a minha empresa ativa".
  Usada em **todas as tabelas de domínio**.

A distinção nasceu de um bug real: quando o RLS passou a autorizar por
pertença, ele autorizou **todas** as empresas do usuário — e as consultas que
não filtravam por conta começaram a misturar dados entre empresas (inbox,
funil, contatos, dashboard). A migration 512 reescreveu mecanicamente todas as
policies de domínio e **aborta se sobrar alguma**.

Regra para tabela nova: **domínio usa `is_active_member`**.

### Papéis

`owner` > `admin` > `agent` > `viewer`, com capacidades derivadas em um único
lugar (`src/lib/auth/roles.ts`) e espelhadas no SQL.

- **viewer** — só leitura
- **agent** — envia mensagem, cria contato, move negócio, dispara campanha
- **admin** — configurações, membros, convites, chaves de API
- **owner** — transferir propriedade, excluir empresa

O campo **cargo** (`sdr` / `closer` / `vendedor`) é **rótulo de negócio, não
permissão** — nenhum ponto do código o lê para autorizar. A matriz fina está
declarada no código como feature futura.

### Configurações

Perfil, segurança (senha, sair de todos os dispositivos), aparência (tema),
WhatsApp (números), templates, respostas rápidas, campos e tags, negócios
(moeda padrão), captação de leads, membros e chaves de API.

### API pública v1

Endpoints para mensagens, contatos, conversas, campanhas e webhooks.
Autenticação por **chave de API** (`wacrm_live_…`, guardada como hash) com
**escopos** independentes do papel de quem a criou. Revogação é suave (a linha
fica como trilha). Paginação por cursor, envelope padronizado de erro.

### Webhooks de saída

Três eventos: `message.received`, `message.status_updated`,
`conversation.created`. Assinatura estilo Stripe (HMAC com timestamp),
**proteção contra SSRF** (recusa loopback, redes privadas, metadata de nuvem) e
auto-desativação do endpoint após 15 falhas seguidas.

**Limite**: entrega é **tentativa única** — não há fila de retry. A
documentação orienta o assinante a deduplicar por ID e reconciliar pelos
endpoints de leitura.

### Internacionalização

`next-intl` com o idioma definido por variável de ambiente (padrão `pt-BR`).
Dois testes automatizados protegem os dicionários: **paridade de chaves** entre
`pt-BR` e `en`, e **validação ICU** de cada string — porque uma string
malformada derruba a árvore de página inteira, não só a própria string.

### Segurança

- **RLS como fronteira**, em três níveis (leitura / operacional / configuração)
- **Inventário de service_role** (`docs/service-role-inventory.md`): toda query
  com service_role deve filtrar por conta **ou** documentar o invariante que a
  torna segura
- **Criptografia** AES-256-GCM para tokens da Meta e segredos de webhook;
  SHA-256 para o que nunca precisa voltar a texto puro (chaves de API, tokens
  de convite)
- **Rate limiting** em todas as superfícies sensíveis
- Trigger que impede um usuário de forjar o próprio papel

---

## E. Motor de Leads

### As três origens

| Origem | Entrada | Autenticação | Descobre a empresa por |
|---|---|---|---|
| **Site** | `POST /api/leads/ingest/site` | token compartilhado | **filial** cadastrada |
| **Meta Lead Ads** | webhook `leadgen` | assinatura HMAC | **form_id** cadastrado |
| **CTWA** (anúncio → WhatsApp) | webhook do inbox | assinatura HMAC | **o número** que recebeu |

O CTWA é o único que **nunca fica sem empresa**: o anúncio aponta para um
número e o número já tem dono.

### O princípio: nunca perder

1. **Grava o bruto antes de qualquer decisão** — se normalização, roteamento ou
   entrega falharem, o evento já está registrado
2. **Sem regra de roteamento ≠ descarte** — vira pendência visível
3. **Falha de entrega ≠ perda** — fica no outbox com retry e backoff
4. **Duplicata não some** — é suprimida **e registrada**, vinculada ao lead que
   a absorveu

### Entrega

O lead vira **negócio no funil**, com o rastreamento de campanha preenchido. O
caminho é um outbox com claim atômico (`FOR UPDATE SKIP LOCKED` — dois workers
nunca pegam o mesmo job), backoff exponencial e 5 tentativas.

O worker é endpoint da aplicação (`/api/leads/worker/tick`), chamado por
agendador externo com segredo compartilhado.

### Painel de operação (`/leads`, somente owner)

- Indicadores do período: recebidos, entregues, na fila, falhas (nº e %) e
  volume por origem
- **Fila de leads sem empresa**, agrupada por origem — uma ação cadastra o
  de-para, adota os parados e enfileira a entrega
- **Lacuna do CTWA**: conversa de anúncio que não virou lead. É a falha que
  *parece* sucesso — a conversa está na inbox e ninguém percebe que o negócio
  não existe
- Reenvio individual ou "todas as falhas do filtro"
- Detalhe com histórico de tentativas, erro de cada uma, payload bruto e link
  para a conversa
- **Conferir com a Meta**: busca ativa por período, mostra o que falta e importa
  sob confirmação, com auditoria

### Atribuição de campanha (CTWA)

A Meta envia os dados do anúncio **só na primeira mensagem** e nunca reenvia. A
captura é passiva, à prova de falha e idempotente. O ID do anúncio é trocado
pelos nomes reais de campanha, conjunto e criativo via Graph API, e aparece no
card do funil e dentro da conversa.

### Marcação e saudação

Tags de origem automáticas por empresa, com slug estável. A tag é **projeção** —
apagar não perde o dado, reprocessar devolve.

Saudação automática por template para leads de formulário (que não têm
conversa): configurável **por origem**, **desligada por padrão**, não reenvia, e
falha não derruba a entrega.

---

## Funcionalidades aparentes

> Coisas que **parecem construídas** na interface ou no schema, mas não fazem
> nada. É a seção mais importante deste documento: cada item aqui é uma
> armadilha onde alguém configura algo e espera um comportamento que não vem.

| # | O que parece | O que é |
|---|---|---|
| 1 | **Agendar campanha** — o passo do assistente se chama "Agendar e enviar", existe `scheduled_at` no banco, situação "Agendado" e tradução | **Não existe agendamento.** Nenhum código escreve `scheduled_at` e não há worker que envie campanha agendada. O único botão é "Enviar agora" |
| 2 | **Automação por horário** (`time_based`) — aparece no construtor, tem validação de agenda, salva e fica ativa | **Nada a dispara.** Não há scheduler. A automação fica na lista, ativa, e nunca roda |
| 3 | **Automação "conversa atribuída"** (`conversation_assigned`) — idem | **Nada a dispara.** Não há dispatcher em lugar nenhum |
| 4 | **Distribuição em rodízio** (`round_robin` ao atribuir conversa) | Pega **sempre o primeiro** perfil da conta. O código admite: *"preserving that shape until a real round-robin algorithm replaces it"* |
| 5 | **Nó `http_fetch`** em flows — aceito pelo banco | **Não implementado** em nenhuma camada. Se um flow chegar nele, a run falha |
| 6 | **Validação de entrada** em `collect_input` (e-mail, telefone, regex) | Aceita a configuração e **ignora** — captura qualquer texto não vazio |
| 7 | **Filtro/agrupamento de template por WABA** | A coluna `waba_id` **nunca é escrita**. Todo template cai no ramo "global" e o filtro é inerte |
| 8 | **Retomar rascunho de campanha** | O rascunho é salvo mas **não há como retomá-lo** — a audiência e as variáveis não são persistidas |
| 9 | **Gerenciar tags em Configurações** | Filtra por `user_id` em vez de `account_id`: cada admin só vê as tags que **ele** criou. As tags de sistema só aparecem para o owner |
| 10 | **Excluir tag de sistema** | O botão aparece; o banco recusa; o usuário recebe um "falha ao excluir" genérico sem explicação |
| 11 | **Criar empresa** | Não há tela. O provisionamento é por função de banco, executada no back-office. A tela "sem empresa" é um beco sem saída |

---

## Dívidas e lacunas

### Prioridade alta

| Item | Onde |
|---|---|
| Envio de campanha orquestrado **no navegador** — fechar a aba interrompe | `use-broadcast-sending.ts` |
| Espelhamento de status **sem guarda de regressão** — um replay pode voltar `read` para `sent` | `status-mirror.ts` |
| Motores (automações/flows/IA) **não checam a janela de 24h** | `engine-send-base.ts` |
| `tag-manager` filtra por `user_id` — quebra multi-membro | `settings/tag-manager.tsx` |
| Middleware não protege `/leads`, `/flows`, `/agents`, `/notifications` (dados seguros pelo RLS; falta o redirect de sessão) | `src/middleware.ts` |
| Rate limiter em memória por processo — **derrotado por deploy multi-instância** | `src/lib/rate-limit.ts` |

### Prioridade média

| Item | Onde |
|---|---|
| Webhooks de saída sem fila de retry (tentativa única) | `webhooks/deliver.ts` |
| Vários caminhos usam "o primeiro número da conta" (mídia, reações, sync de template) | spec 007 |
| RLS de `message_reactions` ainda por `user_id`, anterior ao multi-usuário | migration 009 |
| `conversations.whatsapp_config_id` ainda nullable — invariante só em código | migration 503 |
| Busca do inbox client-side, lista sem paginação | `conversation-list.tsx` |
| Dashboard agrega **tudo no cliente** (o próprio código prevê migração para RPC) | `dashboard/queries.ts` |
| Rosca do funil soma estágios de **todos** os funis | `dashboard/queries.ts` |
| Select de contatos no formulário de negócio carrega a base inteira, sem busca | `deal-form.tsx` |
| `automation_steps` e `contact_tags` sem `account_id` — segurança depende de guarda no chamador | inventário service_role |
| Espelhamento de status faz update sem escopo de conta | inventário service_role |
| Cargo (sdr/closer/vendedor) não influencia permissão alguma | `auth/roles.ts` |
| Pendências travadas em `running` após crash não são recuperadas | `automations/cron` |
| `ko.json` fora dos testes de paridade e ICU | `i18n/parity.test.ts` |

### Prioridade baixa

Notificações com um único tipo e limite fixo de 100; quick replies sem tela de
gestão; MIME de mídia recebida descartado; vídeo e áudio não usam o mesmo
carregamento autenticado da imagem; detecção do erro 131047 por comparação de
string; parser CSV não trata quebra de linha dentro de campo; datas em alguns
lugares com locale `en-US` fixo; textos do feed de atividade, da presença e de
parte das telas de auth ainda em inglês fora do i18n.

### Antes de homologar com dados reais

Prioridade acordada em 2026-07-22, nesta ordem:

1. **Confirmar se já existe agendador rodando.** O cron de automações usa
   `AUTOMATION_CRON_SECRET` e responde 503 sem ele. Se nunca foi agendado,
   descobrimos de quebra que **automações com "aguardar" nunca completaram**.
2. **Agendar o worker de leads** — `GET|POST /api/leads/worker/tick` com o
   header `x-cron-secret`, a cada ~1 min. **Sem isso, lead de site e de
   formulário entra e não entrega.** É configuração, não código.
3. **Corrigir `tag-manager`** (filtra por `user_id`) — hoje um admin que não
   seja o owner não vê as tags de origem criadas pela migration 520, e conclui
   que não existem.
4. **Guarda de regressão no espelhamento de status** — um reenvio de webhook da
   Meta pode voltar "lida" para "enviada", e é justamente nesses números que a
   homologação vai olhar para decidir se confia no sistema.

**Condicionais ao escopo:**

- Se a homologação incluir **campanha real**, a orquestração no navegador vira
  bloqueio: fechar a aba deixa clientes reais parcialmente contatados, sem
  retomada e sem retry.
- Se incluir **automação, flow ou IA**, a falta de checagem da janela de 24h nos
  motores vira bloqueio.

**Verificação sem código, antes de qualquer mensagem sair**: confirmar que a
empresa de homologação não tem automação, flow nem IA ativos respondendo a
cliente real.

**Deliberadamente fora**: as 11
[funcionalidades aparentes](#funcionalidades-aparentes). O custo certo delas é
avisar a operação, não codar — corrigir agora atrasa a homologação para resolver
algo que ela nem exercita.

### Pendências de processo

- **Cron do worker de leads não agendado** em produção — sem ele, leads de site
  e formulário ficam "na fila"
- `LEADS_DEPLOYMENT_ADMINS` **obrigatória antes de um segundo cliente** no mesmo
  deploy (ver aviso no cabeçalho de `auth/deployment-admin.ts`)
- Alertas de mudança de formato de origem (011 US2) — não construídos
- Spec 007: revisão de segurança formal e teste com dois números reais pendentes
- Sem auditoria de leitura para LGPD — **conscientemente fora de escopo** até
  hoje; a spec 003 é sobre autoria de mensagem, não sobre acesso

---

## Rastro das specs

| Spec | Tema | Situação |
|---|---|---|
| 001 | Base de envio | Entregue |
| 002 | Localização pt-BR | Entregue |
| 003 | Autoria de mensagem | Entregue (**não** é auditoria de acesso) |
| 004 | Conversas na ficha | Entregue; verificação visual pendente |
| 005 | Janela de 24h | Entregue; motores não cobertos |
| 006 | Hardening de service_role | Entregue; 3 pontos frágeis no backlog |
| 007 | Multi-número | Entregue; refinamentos cross-número pendentes |
| 008 | Multi-empresa | Entregue |
| 009 | Motor de leads — núcleo | Entregue; US5 (destino externo) **cortada** |
| 010 | CTWA | Entregue |
| 011 | Recuperação e alertas | US1 entregue; US2 (alertas de formato) pendente |
| 012 | Prontidão para escala horizontal | Spec escrita — **bloqueante para N>1** |
| 013 | Observabilidade e operação | Spec escrita |

> As specs 012 e 013 nasceram de uma **auditoria do código** feita em
> 2026-07-24, motivada pela decisão de escalar horizontalmente. Várias das
> dívidas listadas acima foram absorvidas por elas — com arquivo, linha e
> cenário de falha concreto. Ver `specs/012-escala-horizontal/tasks.md` e
> `specs/013-observabilidade/tasks.md`.
