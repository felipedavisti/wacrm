# Research — Multi-conta (Fase 0)

Decisões técnicas para derrubar a invariante "1 account por usuário" com o menor
raio de explosão possível, preservando o RLS e a segregação por account.

## Estado atual (levantado no código)

- **Resolução de account**: `src/lib/auth/account.ts` → `getCurrentAccount()` lê
  `profiles.account_id` + `profiles.account_role` (ponto **único** de resolução;
  `requireRole()` é um wrapper). Toda rota já escopa por `ctx.accountId`.
- **RLS**: `is_account_member(target_account_id, min_role)` (migration 017,
  SECURITY DEFINER) hoje testa `profiles.user_id = auth.uid() AND
  profiles.account_id = target`. Usado por todas as ~36 policies.
- **Papéis reais**: enum `account_role_enum` = `owner | admin | agent | viewer`
  (a spec falava "membro" de forma solta; o nome técnico de "membro operacional"
  é **agent**). `src/lib/auth/roles.ts` espelha a hierarquia (owner 4 … viewer 1).
- **Signup**: trigger `on_auth_user_created` → `handle_new_user()` cria **account +
  profile 'owner'** a cada novo usuário (migration 017).
- **Convite**: `redeem_invitation()` (migration 019) hoje é um **MOVE** — transfere
  o usuário da conta pessoal para a conta do convite e **apaga** a conta antiga;
  **recusa** se o usuário já está numa conta compartilhada ou tem dados.
- **profiles.account_id / account_role**: hoje **NOT NULL** (017).

## Decisões

### D1 — `account_members` como fonte de verdade; `profiles.account_id` vira "conta ativa"

- **Decisão**: criar `account_members(account_id, user_id, role, position, …)`
  (PK composta) como fonte de verdade do **pertencimento** N-para-N. Manter
  `profiles.account_id` — porém **ressignificado** como a **conta ativa** (ponteiro
  mutável do usuário) e `profiles.account_role` como o papel **na conta ativa**
  (denormalizado).
- **Rationale**: `getCurrentAccount()`, `requireRole()` e **todas** as queries que
  já escopam por `ctx.accountId` continuam funcionando **sem alteração** — só muda
  o *significado* de `profiles.account_id` (de "a conta" para "a conta ativa").
  Menor raio de explosão (Constituição VII).
- **Alternativas rejeitadas**: (a) mover a conta ativa para um claim no JWT + RLS
  forçando `account_id = claim` — pesado, exige hook de JWT, e é desnecessário
  porque a conta ativa é um **filtro de visão**, não uma fronteira de segurança
  (o usuário está autorizado em todas as suas contas). (b) tabela separada
  `active_account(user_id, account_id)` — igual a repurposar `profiles.account_id`,
  porém com mais uma junção em todo lugar.

### D2 — Reescrever `is_account_member` para ler `account_members`

- **Decisão**: `is_account_member(target, min_role)` passa a testar existência em
  `account_members` (user = auth.uid(), account = target, rank(role) ≥ rank(min)).
  Segue SECURITY DEFINER.
- **Rationale**: é a **fronteira de segurança** — autoriza o usuário em **todas** as
  contas em que é membro (e só nelas). As ~36 policies continuam idênticas.
  **Ponto sensível de segurança** (Constituição II): esta função é revisada com
  foco em vazamento entre contas antes do merge.

### D3 — Escopo da conta ativa é de aplicação, não de RLS

- **Decisão**: o filtro "conta ativa" continua sendo `ctx.accountId` já pervasivo
  nas rotas (via `getCurrentAccount`). O RLS **não** restringe à conta ativa — só à
  pertença. Trocar de conta = mudar `profiles.account_id`.
- **FR-016 (sem vazamento na troca)**: é correção de **UX/cache**, não de segurança
  (o usuário poderia ver B trocando para B de qualquer jeito). Ao trocar, o cliente
  **invalida todo o cache** de dados escopados por conta (React Query key inclui a
  conta ativa) e refaz as queries.
- **Nota de segurança**: o RLS continua barrando contas **não-membro**. A troca só
  muda qual conta-membro é vista — nenhuma superfície nova de vazamento.

### D4 — Troca de conta via RPC `set_active_account(target)`

- **Decisão**: RPC SECURITY DEFINER que **valida a pertença** (via
  `is_account_member`) e então atualiza `profiles.account_id` + `profiles.account_role`
  (lido de `account_members`) atomicamente; retorna a conta ativa.
- **Rationale**: impede o cliente de apontar a conta ativa para uma conta
  não-membro (a RPC recusa). Escrita atômica dos dois campos.

### D5 — `redeem_invitation` reescrito: ADICIONA vínculo (não MOVE)

- **Decisão**: em vez de mover e apagar a conta pessoal, faz `INSERT` em
  `account_members` (idempotente via `ON CONFLICT DO NOTHING`), marca o convite
  aceito e define a **conta recém-entrada como ativa**. **Não** apaga conta alguma,
  **não** recusa por dados existentes.
- **Rationale**: pertencer a várias contas é o objetivo. Usuários single-account
  não são afetados — só ganham um 2º vínculo. Remove as recusas 23505 antigas.

### D6 — `handle_new_user` para de criar conta (FR-021)

- **Decisão**: novos signups recebem **apenas o profile**, com `account_id = NULL`
  (sem vínculo). Caem no estado "sem empresa" (FR-023) até serem convidados ou
  provisionados.
- **Consequência**: `profiles.account_id` e `profiles.account_role` passam a ser
  **NULLABLE**. O ramo "sem conta" de `getCurrentAccount()` passa a ser o sinal de
  "sem empresa" para a UI (a rota de API ainda responde 403; a UI faz o gate antes).

### D7 — Provisionamento pela TI (FR-019/020): fora do app

- **Decisão**: uma função administrativa (SECURITY DEFINER) ou seed
  `provision_company(nome, primeiro_usuario)` rodada pela TI (SQL Editor /
  service_role): cria `accounts` + `account_members(owner)` + define a conta ativa.
  **Não** exposta na UI. Detalhe de operação — documentado no quickstart.
- **Rationale**: cumpre "só a TI cria empresa" sem construir tela de criação.

### D8 — Derrubar `idx_accounts_one_per_owner` (FR-009)

- **Decisão**: dropar o índice único que impede um usuário ser owner de várias
  contas. Passa a ser permitido (cenário do operador que gerencia Salvador + São Luís).

### D9 — Cargos SDR/closer/vendedor como `position`, separado do `role` de permissão (FR-022)

- **Decisão**: **não** poluir `account_role_enum` (permissão) com os cargos de
  vendas. Em vez disso, `account_members` ganha `position TEXT` (valores: `sdr`,
  `closer`, `vendedor`, ou nulo) **separado** do `role` de permissão (owner/admin/
  agent/viewer). Atribuir "SDR" = `position='sdr'` + `role='agent'` (permissão de
  membro operacional por ora).
- **Rationale**: implementa exatamente a escolha do usuário ("rótulos agora,
  permissão = membro; matriz fina depois") **sem** a fragilidade de estender um
  enum Postgres e ter de atualizar o `CASE` de rank em vários lugares. Depois, a
  matriz fina pode passar a derivar permissão do `position`. Evita mexer em
  `roles.ts`/`is_account_member` rank.
- **Alternativa rejeitada**: `ALTER TYPE account_role_enum ADD VALUE 'sdr'…` — exige
  atualizar todo `CASE WHEN role` (rank) em SQL e TS, e valores de enum não podem
  ser removidos depois; alto custo para "só um rótulo".

## Numeração de migrations

007 usou `501`–`507`. A 008 segue na faixa `500_`, a partir de **`508_`**
(Constituição, Princípio V). Divergências do upstream (single-account) documentadas
em cada migration e no runbook de sync.

## Impacto em superfícies sensíveis (Constituição II — enumerar)

- `is_account_member` (reescrita) — revisar vazamento entre contas.
- `redeem_invitation`, RPCs de membro (018), novo `set_active_account` — SECURITY
  DEFINER; revisar que não concedem vínculo/ativação fora da autorização.
- `handle_new_user` — deixa de criar conta; garantir que não deixa profile órfão
  quebrado.
- Nenhum caminho `service_role` novo; `requireAccountScope` segue válido.
