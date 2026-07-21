# Data Model — Multi-conta (Fase 1)

Fonte da verdade: PostgreSQL (Supabase), região `sa-east-1`. Todas as tabelas
mantêm RLS (Constituição II). Migrations na faixa `508_`+.

## Visão geral da mudança

| Antes (single-account) | Depois (multi-conta) |
|---|---|
| `profiles.account_id` = **a** conta do usuário (NOT NULL) | `profiles.account_id` = **conta ativa** do usuário (NULLABLE) |
| `profiles.account_role` = papel global | papel **na conta ativa** (denormalizado, NULLABLE) |
| pertença: `profiles.account_id` (1 conta) | pertença: **`account_members`** (N contas) |
| `idx_accounts_one_per_owner` (1 owner) | **removido** — owner de N contas |
| signup cria account + profile 'owner' | signup cria **só profile** (sem conta) |

## Entidades

### `account_members` (NOVA — fonte de verdade da pertença)

| Campo | Tipo | Notas |
|---|---|---|
| `account_id` | UUID | FK `accounts(id)` ON DELETE CASCADE |
| `user_id` | UUID | FK `auth.users(id)` ON DELETE CASCADE |
| `role` | `account_role_enum` | permissão: owner/admin/agent/viewer |
| `position` | TEXT NULL | cargo de vendas: `sdr` \| `closer` \| `vendedor` \| NULL (FR-022) |
| `created_at` | TIMESTAMPTZ | default now() |
| `updated_at` | TIMESTAMPTZ | default now() |

- **PK**: `(account_id, user_id)` — um vínculo por par.
- **Índices**: `idx_account_members_user (user_id)` (montar o seletor de empresas);
  `idx_account_members_account (account_id)` (listar o time de uma empresa).
- **RLS**:
  - SELECT: `user_id = auth.uid()` (ver os próprios vínculos) **OU**
    `is_account_member(account_id, 'admin')` (admin vê o time da conta).
  - INSERT/UPDATE/DELETE: `is_account_member(account_id, 'admin')` — só admin/owner
    gerencia membros da conta. (Escritas sensíveis passam pelas RPCs SECURITY
    DEFINER, que aplicam guardas adicionais — ex.: último owner.)
- **Invariante do último owner** (FR-005): não é possível remover/rebaixar o
  **último** `role='owner'` de uma conta — imposto na RPC de remoção/mudança de papel.

### `profiles` (ALTERADA)

| Campo | Mudança |
|---|---|
| `account_id` | NOT NULL → **NULLABLE**. Passa a significar **conta ativa** (última selecionada). NULL = estado "sem empresa" (FR-023). |
| `account_role` | NOT NULL → **NULLABLE**. Papel do usuário **na conta ativa** (denormalizado de `account_members`; atualizado na troca). |

> Repurposar em vez de criar coluna nova mantém `getCurrentAccount()` e as ~36
> policies intactas (research D1).

### `accounts` (quase inalterada)

- Remover `idx_accounts_one_per_owner` (FR-009). `owner_user_id` permanece (dono de
  referência da conta); a pertença operacional é `account_members`.

### `account_invitations` (semântica de aceite muda)

- Estrutura inalterada (já tem `account_id`, `role`, `token_hash`, `expires_at`…).
- **Opcional**: coluna `position TEXT NULL` para o convite já carregar o cargo
  (senão o cargo é definido depois pelo admin). Baixo custo; incluída.
- O **aceite** (`redeem_invitation`) muda de MOVE para ADD (research D5).

## Estados

**Conta ativa (`profiles.account_id`)**:
- `NULL` → **sem empresa** (FR-023): UI mostra tela neutra; nenhuma query de
  domínio retorna dado (não há conta para escopar).
- `<uuid de conta-membro>` → contexto normal; app escopa por essa conta.
- Troca só é válida para contas em `account_members` do usuário (RPC valida).

**Papel (`account_members.role`)**: owner > admin > agent > viewer (inalterado).
Cargo (`position`) é ortogonal e não afeta permissão nesta fase.

## Regras de integridade / invariantes

- **Pertença**: `is_account_member(account)` ⇔ existe linha em `account_members`
  para `(account, auth.uid())`. É a fronteira de segurança (RLS).
- **Conta ativa ⊆ pertença**: `profiles.account_id`, quando não-nulo, DEVE
  referenciar uma conta em que o usuário é membro (garantido pela RPC de troca e
  pelo aceite de convite; um trigger/constraint de checagem é opcional como cinto).
- **Último owner**: toda conta tem ≥1 `role='owner'` em `account_members` a todo
  momento (guarda nas RPCs).
- **Backfill (FR-004)**: para cada `profiles` atual com `account_id`/`account_role`
  não-nulos, inserir `account_members(account_id, user_id, role=account_role,
  position=NULL)`. `profiles.account_id` permanece como a conta ativa. Zero perda
  de acesso.
- **Signup (FR-021)**: novo profile nasce com `account_id = NULL` (sem
  `account_members`). Sem autocriação de conta.

## Migrations planejadas (faixa 508_+)

1. **`508_account_members.sql`** — cria `account_members` (+RLS, índices); backfill
   a partir de `profiles`; dropa `idx_accounts_one_per_owner`; torna
   `profiles.account_id`/`account_role` NULLABLE; adiciona `account_invitations.position`.
2. **`509_is_account_member_multi.sql`** — reescreve `is_account_member` para ler
   `account_members` (fronteira de segurança).
3. **`510_membership_rpcs.sql`** — `set_active_account(target)`; reescreve
   `redeem_invitation` (ADD, define ativa); atualiza RPCs de membro (018) para
   escrever em `account_members` + guarda do último owner.
4. **`511_handle_new_user_no_account.sql`** — `handle_new_user` cria só o profile
   (sem conta). Função opcional `provision_company(...)` para a TI (FR-019/020).

Todas idempotentes (`IF NOT EXISTS` / `CREATE OR REPLACE`) quando prático;
divergências do upstream comentadas em cada arquivo (Princípio V).
