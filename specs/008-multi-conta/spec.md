# Especificação de Feature: Multi-conta (múltiplos accounts por usuário + troca de empresa)

**Feature Branch**: `008-multi-conta`

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "Fundação multi-account: um usuário pode pertencer a múltiplos accounts (empresas) e transitar entre eles sem deslogar. Papel por vínculo (SDR/closer/vendedor/admin). Seletor de empresa ativa; ao selecionar, enxerga tudo daquela empresa (leads, contatos, conversas, automações). Primeira spec de um programa maior (Motor de Leads multi-empresa)."

## Contexto e Problema

Hoje o CRM é multi-tenant por `account`: a migration 017 já carimbou `account_id` (NOT NULL) em **todas** as tabelas de domínio (contatos, conversas, deals, pipelines, automações, flows, broadcasts, whatsapp_config, meta_apps…) e o isolamento é garantido por RLS ancorado em `is_account_member(account_id)`. Porém há uma invariante **travada**: **um usuário pertence a exatamente um account** (índice único `idx_accounts_one_per_owner` + membership única via a FK `profiles.account_id`).

O cenário de negócio exige o oposto: uma mesma pessoa opera **várias empresas** (ex.: "Vitalmed Salvador" e "Vitalmed São Luís", cada uma um account, com seus próprios números, contatos, leads e automações) e precisa **transitar entre elas sem deslogar e logar de novo**. Esta feature derruba a invariante de membership única e introduz o **seletor de empresa ativa**, preservando integralmente o isolamento de dados por account.

Esta é a **primeira spec de um programa maior** (transformar o CRM num receptor de leads multi-empresa — o "Motor de Leads"). As features seguintes (ingestão de leads, roteamento campanha→empresa, painel de reprocessamento, destino configurável por conta) **dependem desta fundação** e ficam fora do escopo aqui.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operador alterna entre empresas sem deslogar (Priority: P1)

Como pessoa que atende mais de uma empresa (ex.: SDR/closer/vendedor que cobre Salvador e São Luís), quero trocar a empresa ativa por um seletor no topo e ver o CRM inteiro passar a refletir aquela empresa, sem precisar sair e entrar de novo, para operar as duas ao longo do dia com fluidez.

**Why this priority**: é o coração da feature e o que destrava todo o programa Motor de Leads. Sem a troca fluida, a operação multi-empresa é inviável.

**Independent Test**: dar a um usuário vínculo com duas empresas com dados distintos; logar uma vez; alternar no seletor e verificar que listas (contatos, conversas, etc.) trocam para os dados da empresa selecionada, sem novo login.

**Acceptance Scenarios**:

1. **Given** um usuário com vínculo em duas empresas, **When** ele abre o seletor de empresa, **Then** vê listadas exatamente as duas empresas em que tem vínculo (e nenhuma outra).
2. **Given** a empresa "Salvador" ativa, **When** o usuário seleciona "São Luís", **Then** todo o app passa a mostrar apenas os dados de "São Luís" (contatos, conversas, automações, etc.), sem recarregar uma nova sessão de login.
3. **Given** a empresa ativa foi trocada, **When** o usuário navega para qualquer área, **Then** a empresa ativa permanece a selecionada durante a navegação e ao reabrir o app (última selecionada).
4. **Given** um usuário com vínculo em **uma única** empresa, **When** ele usa o app, **Then** a experiência não regride — o seletor pode ficar oculto/somente-leitura e ele opera normalmente.

---

### User Story 2 — Isolamento por empresa preservado na troca (Priority: P1)

Como responsável pela segurança dos dados, quero que ao selecionar uma empresa o usuário veja e opere **somente** os dados daquela empresa, e que a troca nunca vaze dados da empresa anterior, para manter a segregação multiempresa que já existe.

**Why this priority**: o isolamento é um requisito não-negociável (LGPD, Princípio de segregação). A introdução do multi-vínculo não pode abrir brecha entre tenants.

**Independent Test**: com um usuário vinculado a A e B e um terceiro vinculado só a A, tentar acessar dados de B (via id/URL direta) com o usuário sem vínculo e confirmar bloqueio; alternar A→B e confirmar que telas/listas não exibem resíduo de A.

**Acceptance Scenarios**:

1. **Given** um usuário sem vínculo com a empresa X, **When** ele tenta acessar um recurso de X diretamente (id/URL), **Then** o acesso é negado (não vê o dado).
2. **Given** a empresa A ativa com dados carregados, **When** o usuário troca para B, **Then** nenhuma tela continua exibindo dados de A após a troca.
3. **Given** uma ação de escrita (criar contato, responder conversa), **When** executada, **Then** o registro é atribuído à empresa **ativa** no momento da ação.

---

### User Story 3 — Usuários atuais migram sem perder acesso (Priority: P1)

Como usuário existente do CRM, quero continuar acessando a minha empresa normalmente depois da mudança, para que a migração para o modelo multi-vínculo não interrompa meu trabalho.

**Why this priority**: a troca de FK única → tabela de vínculos é uma migração estrutural; qualquer perda de acesso é um incidente. Precisa ser provada como parte da entrega.

**Independent Test**: rodar a migração num snapshot com usuários existentes (cada um com 1 account) e verificar que cada um mantém vínculo, papel e acesso à sua empresa, sem intervenção manual.

**Acceptance Scenarios**:

1. **Given** um usuário que hoje pertence a exatamente um account, **When** a migração é aplicada, **Then** ele passa a ter um vínculo equivalente (mesmo account, mesmo papel), sem perda de acesso.
2. **Given** o dono (owner) de um account, **When** a migração é aplicada, **Then** seu papel de responsável é preservado no vínculo.
3. **Given** o modelo multi-vínculo ativo, **When** a suíte de testes de isolamento por account roda, **Then** continua verde (o RLS por `account` não regride).

---

### User Story 4 — Administrador concede e revoga acesso de pessoas às empresas (Priority: P2)

Como administrador de uma empresa, quero conceder a uma pessoa acesso à minha empresa (com um papel) e revogar quando necessário, para montar o time que opera cada empresa.

**Why this priority**: é o que torna o multi-vínculo gerenciável na prática; sem isso os vínculos só existiriam por migração. Fica em P2 porque a operação multi-empresa (US1/US2) já entrega valor com vínculos criados.

**Independent Test**: como admin de B, conceder acesso a um usuário que já pertence a A; verificar que B aparece no seletor daquele usuário; revogar e verificar que B some.

**Acceptance Scenarios**:

1. **Given** um admin da empresa B e uma pessoa que já pertence à empresa A, **When** o admin concede acesso dela a B com um papel, **Then** B passa a aparecer no seletor de empresa daquela pessoa, com o papel definido.
2. **Given** uma pessoa com vínculo em B, **When** o admin revoga o acesso, **Then** B some do seletor dela imediatamente e, se B estava ativa na sessão dela, ela é levada a outra empresa em que tenha vínculo (ou a um estado "sem empresa").
3. **Given** uma empresa com um único responsável (owner), **When** se tenta revogar o acesso desse último responsável, **Then** o sistema impede (a empresa não pode ficar sem responsável).

---

### User Story 5 — Papel por vínculo governa o que a pessoa faz em cada empresa (Priority: P2)

Como operação, quero que a mesma pessoa possa ter papéis diferentes em empresas diferentes (ex.: admin numa, vendedor em outra) e que suas permissões reflitam o papel da **empresa ativa**, para que o acesso seja correto em cada contexto.

**Why this priority**: dá o controle correto por empresa. P2 porque o mecanismo de papel já existe no sistema; aqui ele passa a ser por vínculo em vez de global.

**Independent Test**: dar a um usuário papel de admin em A e papel de membro em B; alternar entre elas e verificar que as capacidades administrativas aparecem só em A.

**Acceptance Scenarios**:

1. **Given** um usuário admin em A e membro em B, **When** A está ativa, **Then** ele vê as ações administrativas de A; **When** B está ativa, **Then** ele não as vê.
2. **Given** o papel de um usuário numa empresa é alterado, **When** ele usa aquela empresa, **Then** suas permissões passam a refletir o novo papel.

---

### Edge Cases

- **Usuário sem nenhum vínculo** (removido de todas as empresas): o app apresenta um estado claro de "sem empresa" em vez de erro ou tela vazia ambígua; nenhum dado de nenhuma empresa é exibido.
- **Empresa ativa revogada durante a sessão**: o usuário é redirecionado para outra empresa em que tenha vínculo, ou para o estado "sem empresa"; nenhuma tela continua mostrando a empresa perdida.
- **Empresa ativa excluída**: a seleção cai para outra empresa válida do usuário (ou "sem empresa").
- **Deep-link para recurso de empresa que não é a ativa** (mas o usuário tem vínculo): o app resolve para o contexto correto ou orienta a trocar de empresa — sem vazar nem quebrar.
- **Deep-link para recurso de empresa sem vínculo**: acesso negado.
- **Requisições em voo durante a troca**: respostas da empresa anterior não podem sobrescrever a visão da empresa recém-selecionada.
- **Último responsável (owner) tentando sair/ser removido**: bloqueado — a empresa não pode ficar órfã.

## Requirements *(mandatory)*

### Functional Requirements

**Vínculo usuário ↔ empresa (membership)**

- **FR-001**: O sistema DEVE permitir que um usuário pertença a **múltiplos** accounts (empresas) simultaneamente.
- **FR-002**: Cada vínculo usuário↔empresa DEVE carregar um **papel próprio**, independente por empresa (a mesma pessoa pode ter papéis diferentes em empresas diferentes).
- **FR-003**: A resolução de pertencimento DEVE migrar da FK única (`profiles.account_id`) para um modelo de **vínculos N-para-N**, **sem regredir** o isolamento por account — o RLS continua ancorado em `account` via `is_account_member()`.
- **FR-004**: A migração DEVE criar, para **cada usuário existente**, um vínculo equivalente ao seu account atual (mesmo papel, preservando a condição de responsável/owner), sem perda de acesso e sem intervenção manual.
- **FR-005**: O sistema DEVE impedir que uma empresa fique **sem responsável** (não é possível remover/rebaixar o último owner de uma empresa).

**Concessão e revogação de acesso**

- **FR-006**: Um administrador de uma empresa DEVE poder **conceder** acesso de uma pessoa a essa empresa, definindo o papel dela naquela empresa. A concessão DEVE reusar o **mecanismo de convite** existente (a pessoa recebe e **aceita** um convite para a empresa adicional); um usuário que já pertence a outra(s) empresa(s) DEVE poder aceitar um convite para uma empresa adicional sem perder os vínculos anteriores.
- **FR-007**: Um administrador DEVE poder **revogar** o acesso de uma pessoa a uma empresa.
- **FR-008**: Ao revogar o acesso, a empresa DEVE sumir imediatamente do seletor da pessoa; se era a empresa ativa na sessão dela, a sessão DEVE ser levada a outra empresa com vínculo ou ao estado "sem empresa".
- **FR-009**: Um mesmo usuário DEVE poder ser **responsável (owner)/administrador de mais de uma empresa** simultaneamente. Isso derruba, deliberadamente, o índice `idx_accounts_one_per_owner` (um dono por usuário), casando com o cenário de um operador central que cria e gerencia várias empresas (ex.: Salvador + São Luís).

**Empresa ativa e troca (seletor)**

- **FR-010**: A interface DEVE oferecer um **seletor de empresa ativa** que lista **somente** as empresas em que o usuário tem vínculo.
- **FR-011**: Selecionar uma empresa DEVE **trocar o contexto ativo** de modo que todo o app (contatos, conversas, automações, e as demais áreas por account) passe a refletir **apenas** a empresa ativa, **sem novo login**.
- **FR-012**: A empresa ativa DEVE **persistir** durante a navegação e ao reabrir o app (por padrão, a última selecionada pelo usuário).
- **FR-013**: Para um usuário com vínculo em **uma única** empresa, a experiência NÃO DEVE regredir — o seletor pode ficar oculto/somente-leitura e o app opera como hoje.
- **FR-014**: Quando um usuário passa a ter (ou perde) vínculo com uma empresa, o seletor dele DEVE refletir a mudança no máximo no próximo ciclo de sessão/atualização.

**Isolamento e atribuição**

- **FR-015**: O sistema NÃO DEVE permitir que um usuário veja ou opere dados de uma empresa em que **não tem vínculo**, mesmo por acesso direto (id/URL).
- **FR-016**: A troca de empresa NÃO DEVE **vazar** dados da empresa anterior — nenhuma tela/lista pode continuar exibindo dados da empresa que deixou de estar ativa.
- **FR-017**: Toda ação de **escrita** DEVE ser atribuída à empresa **ativa** no momento da ação.

**Papéis**

- **FR-018**: O **papel do usuário na empresa ativa** DEVE governar o que ele pode fazer naquele contexto, reusando o modelo de papéis existente do sistema.

### Key Entities *(include if feature involves data)*

- **Vínculo de Conta (Account Membership)**: relação N-para-N entre um usuário e uma empresa (account), com **papel** próprio e carimbos de data. Substitui a membership única via `profiles.account_id` como fonte de verdade de pertencimento.
- **Empresa (Account)**: unidade de tenancy — inalterada como dona dos dados. Passa a ter N usuários vinculados com papéis possivelmente distintos.
- **Empresa Ativa (contexto de sessão)**: a empresa atualmente selecionada por um usuário; define o recorte que o app inteiro enxerga. Persistida como "última selecionada".
- **Papel de Vínculo**: o papel do usuário **naquela** empresa (reusa o conjunto de papéis já existente; a semântica fina SDR/closer/vendedor é tratada fora desta spec — ver Assumptions).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um usuário com acesso a múltiplas empresas alterna entre elas e vê os dados corretos da empresa selecionada em até **3 segundos**, sem realizar novo login.
- **SC-002**: **100%** dos usuários existentes mantêm acesso à sua empresa após a migração — **zero** perda de acesso.
- **SC-003**: **Zero** vazamento entre empresas: **100%** das tentativas de acesso a dados de uma empresa sem vínculo são bloqueadas (verificável por teste automatizado).
- **SC-004**: O isolamento por empresa **não regride** — a suíte existente de testes de tenancy/RLS permanece integralmente verde após a mudança.
- **SC-005**: Uma concessão ou revogação de acesso reflete no seletor da pessoa afetada em no máximo **1 ciclo de sessão/atualização**.
- **SC-006**: Após trocar de empresa, **nenhuma** tela exibe dado residual da empresa anterior (verificável por teste de fluxo de troca).

## Assumptions

- **Papéis reusam o conjunto existente** do sistema (owner/admin/membro, per migration 017). A semântica de negócio fina de **SDR/closer/vendedor** e uma **matriz de permissões granular** por papel ficam **fora desta spec** (feature posterior; dependem, inclusive, dos módulos de leads). Aqui o papel apenas passa a ser **por vínculo** em vez de global.
- **Empresa ativa** persiste como "última selecionada" por usuário; no primeiro acesso pós-migração, cai na única empresa que o usuário possui.
- **i18n pt-BR/en** para todos os rótulos novos (seletor de empresa, gestão de acesso, estado "sem empresa"), com paridade validada (feature 002).
- **Migrations na próxima faixa livre**; a divergência do upstream (derrubar `idx_accounts_one_per_owner` e a membership via FK única) é **deliberada e documentada** (Constituição, Princípio V — disciplina de sync com upstream).
- A concessão de acesso a uma empresa adicional **reusa o mecanismo de convite** existente (account_invitations + RPCs de convite), com aceite — decisão fechada (FR-006).
- Um usuário pode ser **owner de múltiplas empresas** — o índice `idx_accounts_one_per_owner` será derrubado (FR-009).

## Fora de Escopo (desta 008)

- Qualquer funcionalidade de **leads / Motor**: ingestão de origens, `routing_map` (campanha→empresa), outbox/retry, painel de reprocessamento, **destino configurável por conta** — tudo isso é da **009+**.
- **Matriz de permissões granular** por papel de vendas (SDR/closer/vendedor).
- Uma **camada organizacional acima do account** (grupo/holding com visão consolidada/roll-up entre empresas) — não é necessária: cada empresa é um account independente e a visão é sempre por empresa ativa.
- Autoprovisionamento/criação em massa de empresas.

## Dependências

- Modelo de `accounts` + função `is_account_member()` e o carimbo `account_id` em todas as tabelas de domínio (migration 017).
- Mecanismo de convites/associação de usuários a account (RPCs de convite — migration 019).
- Infraestrutura de i18n pt-BR/en (feature 002).
