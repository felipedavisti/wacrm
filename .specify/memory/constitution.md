<!--
RELATÓRIO DE IMPACTO DE SINCRONIZAÇÃO
=====================================
Mudança de versão: (nenhuma) → 1.0.0
Ratificação: adoção inicial (2026-07-16)

Princípios (todos recém-definidos):
  I.   Privacidade, LGPD e Dados Sensíveis (INEGOCIÁVEL)
  II.  Segurança É a Camada de Autorização (INEGOCIÁVEL)
  III. Somente API Oficial do WhatsApp Business
  IV.  Mudança Dirigida por Spec
  V.   Disciplina de Merge com o Upstream
  VI.  Hospedagem Gerenciada por Padrão, com Isolamento de Ambientes
  VII. Manutenibilidade para Time Pequeno

Seções adicionadas:
  - Requisitos de Segurança & Compliance
  - Fluxo de Desenvolvimento & Portões de Qualidade
  - Governança

Consistência dos templates:
  ✅ .specify/templates/plan-template.md — o portão "Constitution Check" é genérico
     (referencia este arquivo dinamicamente); não requer edição fixa.
  ✅ .specify/templates/spec-template.md — template padrão, consistente.
  ✅ .specify/templates/tasks-template.md — template padrão, consistente.

TODOs adiados: nenhum. Data de ratificação = data da adoção inicial (2026-07-16).
-->

# Constituição do wacrm

O wacrm é um CRM de WhatsApp comercial da **Fnx Social**, derivado (fork) de
`ArnasDon/wacrm`. É um produto **horizontal**, destinado a clientes de diversos
segmentos, entregue no modelo de um-deploy-por-cliente. A **vitalmed** (área de
saúde) é o primeiro cliente. Como um cliente de saúde está em escopo desde o
primeiro dia, o produto é construído desde o início para processar **dados
pessoais sensíveis** sob a LGPD — o rigor não é rebaixado quando o cliente não é
de saúde. Esta constituição define as regras inegociáveis que toda spec, plano,
tarefa e mudança DEVE satisfazer.

## Princípios Fundamentais

### I. Privacidade, LGPD e Dados Sensíveis (INEGOCIÁVEL)

Todo cliente processa dados pessoais de titulares brasileiros, então a LGPD se
aplica a **todos** os clientes. Além disso, clientes da área de saúde (como a
vitalmed, o primeiro cliente) trafegam **dados pessoais sensíveis** — e como esse
tipo de cliente está em escopo desde o primeiro dia, o produto DEVE ser
construído para o padrão mais alto de tratamento. Portanto:

- A residência dos dados DEVE ser o Brasil. Todo projeto Supabase (dev e prod) é
  criado na região `sa-east-1` (São Paulo). Um projeto em qualquer outra região
  NÃO DEVE conter dados reais.
- O desenvolvimento NÃO DEVE rodar contra produção ou dados reais de cliente. Dev
  e prod são **projetos cloud separados** (ver Princípio VI).
- Todo terceiro que recebe dados de mensagem é um **operador de dados e DEVE ser
  explicitamente declarado** antes do uso, por deployment de cliente. Hoje os
  únicos operadores são a API oficial da Meta (Cloud API) e o Supabase. Habilitar
  o assistente de IA opcional adiciona um provedor de modelo (OpenAI/Anthropic)
  como operador e DEVE ser tratado como decisão de compliance, não como um
  simples toggle de feature.
- **Auditoria de acesso é uma capacidade obrigatória.** Quem leu qual contato ou
  conversa DEVE ser registrável. Esta é uma lacuna conhecida hoje (não existe
  tabela de auditoria) e DEVE ser fechada antes de o produto carregar dado real
  em escala — com prioridade máxima para clientes de saúde.

**Justificativa**: O controlador dos dados é o cliente; a Fnx Social é a
operadora que constrói e roda o sistema. Errar em residência, isolamento de
ambiente, declaração de operadores e auditoria é uma falha legal e de confiança —
não um bug. Construir para o padrão de dado sensível desde o início evita ter de
reformar o produto quando o próximo cliente de saúde chegar.

### II. Segurança É a Camada de Autorização (INEGOCIÁVEL)

A autorização é imposta pelo banco de dados, não por convenção:

- O Row-Level Security (RLS) DEVE permanecer habilitado em toda tabela (hoje
  36/36), e toda checagem de tenancy passa por `is_account_member`. Uma tabela
  nova sem RLS é um defeito que DEVE bloquear o merge.
- A chave `service_role` NUNCA DEVE chegar ao código do cliente. É exclusiva do
  servidor.
- Os caminhos de código que contornam a RLS com `service_role` — o webhook, o
  `whatsapp/config` e os admin-clients de flows/automations/ai — são a
  **superfície de auditoria**. Qualquer mudança que os toque DEVE ser revisada
  contra vazamento de dados entre contas antes do merge.
- Webhooks de entrada DEVEM falhar fechado: assinatura ausente ou inválida
  rejeita a requisição. Falhar aberto nunca é aceitável.
- Segredos em repouso DEVEM ser criptografados (AES-256-GCM). A `ENCRYPTION_KEY`
  de produção vive num cofre de segredos, é idêntica em todas as máquinas que
  compartilham um projeto e **nunca é rotacionada sem necessidade** — rotacionar
  invalida todo token de WhatsApp armazenado e força cada conta a reconectar.

**Justificativa**: Neste código o navegador consulta o banco diretamente; sem
RLS não existe isolamento entre clientes. Segurança não é uma feature para
adicionar depois — é o mecanismo sobre o qual o produto inteiro se apoia.

### III. Somente API Oficial do WhatsApp Business

O único canal de mensagens é a API oficial da Meta (WhatsApp Business API / Cloud
API).

- Provedores não-oficiais (pontes por QR / WhatsApp Web) NÃO DEVEM ser
  introduzidos. Violam os termos da Meta, arriscam banir o número do cliente e
  adicionam um operador de dados não declarado.
- A **janela de atendimento de 24 horas** é uma restrição permanente do produto.
  O sistema DEVE tratá-la de forma graciosa — proativamente, e não deixando a
  Meta rejeitar o envio e exibir um erro cru. Fechar essa lacuna é trabalho de
  produto obrigatório.

**Justificativa**: O número do cliente é como os pacientes falam com a clínica.
Um banimento ou uma falha confusa é um incidente de continuidade de negócio, e o
custo de compliance de um canal não-oficial é inaceitável para dado de saúde.

### IV. Mudança Dirigida por Spec

Mudança não-trivial é especificada antes de ser construída.

- Qualquer mudança em um **axioma central do modelo de dados** DEVE passar por
  uma spec escrita primeiro. O exemplo canônico é migrar de um-número-por-conta
  para N-números-por-conta (`docs/spec-multi-numero.md`), que altera índices de
  unicidade e o significado da identidade de uma conversa.
- **Decisões de produto/UX precedem decisões de schema.** Com dois dos três
  integrantes atuando como PO/UX, as respostas de produto (ex.: "um contato,
  threads separadas por número") são resolvidas antes de a migration ser escrita.
- As specs vivem no fluxo do spec-kit (`/speckit-specify` → `/speckit-plan` →
  `/speckit-tasks`). A spec de multi-número é a primeira spec formal.

**Justificativa**: Os axiomas deste sistema estão guardados em índices de
unicidade e políticas de RLS. Mudar um improvisando no código produz corrupção
silenciosa de dados ou vazamento entre contas; uma spec força a decisão de
produto a aparecer primeiro.

### V. Disciplina de Merge com o Upstream

Este é um fork de um template de mantenedor único que não aceita contribuições de
feature, então o fork carrega a própria manutenção para sempre.

- Prefira **customização aditiva** (arquivos novos) a reescritas no lugar, para
  minimizar a superfície de conflito de merge. Isso vale especialmente para o
  design system e para qualquer feature em cima de `src/components`.
- Novas migrations de banco DEVEM usar a **faixa de numeração `500_`** (o upstream
  está em `036`) para evitar colisão de nome e de ordem.
- Divergências deliberadas do upstream DEVEM ser documentadas onde são feitas
  (ex.: a mudança de auth multi-app no webhook, a mudança de índice do
  multi-número).
- O SHA do commit do upstream incorporado DEVE ser rastreado a cada merge. Linha
  de base: `b867760` (2026-07-10). Correções de segurança do upstream são
  trazidas por cherry-pick prontamente.

**Justificativa**: Todo arquivo do upstream deixado intocado é um conflito de
merge que nunca acontece. Disciplina aqui é o que mantém barato puxar as
correções de segurança do upstream, em vez de transformar o fork num
congelamento permanente.

### VI. Hospedagem Gerenciada por Padrão, com Isolamento de Ambientes

- O Supabase Cloud gerenciado é o **padrão** para dev e prod. Operar a stack
  self-hosted completa é rejeitado no caso padrão por ser pesado demais para um
  time de três pessoas, especialmente sob o modelo de um-deploy-por-cliente.
- **Self-host é um tier premium**, oferecido apenas quando um contrato de cliente
  exigir on-premise ou residência de dados além do que a região gerenciada
  oferece.
- Dev e prod DEVEM ser **projetos cloud separados** (reforça o Princípio I).

**Justificativa**: O time detém os dados, o código, o schema e a portabilidade
independentemente de quem opera os servidores. Delegar a operação recompra o
único recurso escasso de um time de três pessoas — atenção — sem abrir mão da
propriedade.

### VII. Manutenibilidade para Time Pequeno

- A stack é deliberadamente sem graça: Next.js + Supabase + Tailwind. Novas
  dependências e novos padrões DEVEM justificar seu custo de manutenção frente a
  um time de três pessoas.
- **Um deploy por cliente** para isolamento: a Fnx Social opera N deployments
  para N clientes de segmentos variados, e o raio de explosão de qualquer bug ou
  incidente é um único cliente.
- O sistema DEVE permanecer operável e revisável por três pessoas. Complexidade
  que só um especialista mantém é passivo, não sofisticação.

**Justificativa**: O recurso escasso é gente, não processamento. Qualquer coisa
que não possa ser rodada, depurada e raciocinada por este time acabará não sendo
rodada, depurada nem raciocinada por ninguém.

## Requisitos de Segurança & Compliance

- Cobertura de RLS, confinamento do `service_role`, webhooks que falham fechado e
  criptografia de segredos com AES-256-GCM (Princípio II) são portões de release,
  não aspirações.
- Os cinco caminhos que contornam a RLS via `service_role` DEVEM ser enumerados
  na revisão sempre que tocados.
- Um inventário de operadores de dados (LGPD) DEVE ser mantido atualizado;
  habilitar qualquer novo serviço externo que veja dados de mensagem o atualiza.
- A auditoria de acesso (Princípio I) é rastreada como trabalho de produto
  obrigatório até ser entregue.
- Segredos de produção (`ENCRYPTION_KEY`, chaves de serviço, app secrets da Meta,
  access tokens do Supabase) DEVEM ficar em cofre e nunca ser commitados. `.env*`
  é ignorado pelo git e DEVE permanecer assim.

## Fluxo de Desenvolvimento & Portões de Qualidade

- **Ambientes**: o desenvolvimento local aponta para um projeto cloud de dev;
  nunca para prod. O `.env.local` (segredos de dev, incl. `ENCRYPTION_KEY`) é
  compartilhado entre as máquinas do time via cofre, nunca commitado, e mantido
  idêntico para que os tokens do banco compartilhado descriptografem em toda
  máquina.
- **Migrations**: escritas em `supabase/migrations/` na faixa `500_`, aplicadas a
  um projeto via Supabase CLI (`db push`) ou, quando a rede corporativa bloquear
  a porta 5432, via uma rede não-corporativa ou o SQL Editor do painel.
  Idempotentes (`IF NOT EXISTS`) quando prático.
- **Fluxo do spec-kit** governa features não-triviais: constitution → specify →
  (clarify) → plan → tasks → implement. Decisões de produto/UX são resolvidas na
  spec antes do schema.
- **CI**: typecheck e build DEVEM passar em toda mudança (herdado do upstream).
- **Sincronização com upstream**: feita em branch dedicada, revisada, testada e
  só então mergeada na `main`; o SHA incorporado é registrado.

## Governança

- Esta constituição se sobrepõe a práticas ad-hoc. Quando um plano ou tarefa
  conflita com um princípio, o princípio vence ou o princípio é emendado antes —
  nunca contornado em silêncio.
- **Emendas** requerem: justificativa escrita, concordância do time e um
  incremento de versão conforme a política abaixo. Emendas que mudem como os
  dados são tratados ou isolados (Princípios I, II, VI) exigem, adicionalmente,
  confirmar que não há regressão frente às obrigações da LGPD.
- **Política de versionamento** (semântico): MAJOR para remoção ou redefinição de
  princípio incompatível com o anterior; MINOR para novo princípio ou orientação
  materialmente expandida; PATCH para esclarecimentos e redação.
- **Revisão de compliance**: todo `/speckit-plan` de uma spec DEVE passar no
  portão Constitution Check. Revisões de mudanças que toquem a superfície de
  auditoria, RLS, segredos ou operadores de dados DEVEM confirmar explicitamente
  a conformidade com os Princípios I e II.
- Especificidades de runtime e ambiente vivem no repositório (`AGENTS.md`,
  `CLAUDE.md`, `docs/`) e na memória do time; este documento guarda os princípios
  que esses docs servem.

**Versão**: 1.0.0 | **Ratificada**: 2026-07-16 | **Última emenda**: 2026-07-16
