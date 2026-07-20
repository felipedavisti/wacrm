# Implementation Plan: Multi-conta (múltiplos accounts por usuário + troca de empresa)

**Branch**: `008-multi-conta` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-multi-conta/spec.md`

## Summary

Derrubar a invariante "1 account por usuário" e introduzir a **troca de empresa sem
re-login**, com o menor raio de explosão possível. Abordagem (Fase 0): criar
`account_members` como **fonte de verdade da pertença N-para-N** e **ressignificar
`profiles.account_id` como "conta ativa"** — assim `getCurrentAccount()`,
`is_account_member()` e as ~36 policies de RLS continuam funcionando; muda-se apenas
a resolução da pertença (FK única → tabela) e adiciona-se o seletor de empresa. O
RLS segue sendo a fronteira de segurança (autoriza o usuário em todas as suas
contas); a "conta ativa" é um **filtro de visão** de aplicação, persistido no
servidor por usuário. Cargos de vendas (SDR/closer/vendedor) entram como `position`
separado do `role` de permissão. Signup deixa de criar conta; empresas são
provisionadas pela TI fora do app; acesso adicional entra por **convite aditivo**.

## Technical Context

**Language/Version**: TypeScript 5 / Node (Next.js 16, App Router)

**Primary Dependencies**: Next.js 16, Supabase (Postgres 15 + Auth + RLS),
Tailwind; i18n pt-BR/en (feature 002); React Query (invalidação de cache na troca).

**Storage**: PostgreSQL (Supabase, `sa-east-1`). Nova tabela `account_members`;
alteração de `profiles`/`accounts`/`account_invitations`; RPCs SECURITY DEFINER.

**Testing**: Vitest (unit + integração de RPC/migration); reuso da suíte de tenancy
existente como portão de não-regressão (SC-004).

**Target Platform**: Web (deploy por cliente; Supabase Cloud gerenciado).

**Project Type**: Web application (Next.js + Supabase), monorepo único.

**Performance Goals**: troca de empresa reflete dados corretos em ≤ 3s (SC-001);
volume de contas por usuário baixo (poucas empresas) — sem preocupação de escala.

**Constraints**: RLS habilitado em toda tabela (nova `account_members` inclusa);
`service_role` nunca no cliente; migrations na faixa `500_`+ (a partir de `508_`);
i18n com paridade; divergência do upstream documentada.

**Scale/Scope**: 1 tabela nova; ~4 migrations; ~2 rotas HTTP; 1 componente de
seletor + tela "sem empresa"; reescrita de 3–4 RPCs. Poucos usuários por deploy.

## Constitution Check

*GATE: passar antes da Fase 0 e reavaliar após a Fase 1.*

| Princípio | Avaliação | Status |
|---|---|:--:|
| I. Privacidade/LGPD | Sem novo PII; membership é user↔account. Residência inalterada. Auditoria de acesso não regride. | ✅ |
| II. Segurança = autorização (RLS) | **Superfície crítica.** `account_members` nasce com RLS; `is_account_member` reescrita (fronteira de segurança) e as RPCs SECURITY DEFINER (`set_active_account`, `redeem_invitation`, membro) DEVEM ser revisadas contra vazamento/ativação fora de autorização antes do merge. Conta ativa é filtro de visão, não fronteira — o RLS continua barrando contas não-membro. | ✅ (com revisão obrigatória) |
| III. Só API oficial WhatsApp | Não toca no canal. | ✅ |
| IV. Mudança dirigida por spec | Muda um **axioma central** (pertença/identidade de conta) — feito via spec/plan/tasks; decisões de produto fechadas no clarify. | ✅ |
| V. Disciplina de merge com upstream | Divergência forte do modelo single-account do upstream. Migrations `508_`+; cada divergência comentada no arquivo e no runbook de sync; SHA base registrado. | ✅ (com documentação) |
| VI. Hospedagem gerenciada/isolamento | Sem mudança de hosting; dev/prod separados. | ✅ |
| VII. Manutenibilidade (time pequeno) | Design de **menor atrito** (repurposar `profiles.account_id`, sem re-chavear 36 tabelas nem estender enum). Uma tabela + RPCs. | ✅ |

**Resultado do gate**: PASS. Sem entradas em Complexity Tracking. Duas obrigações
carregadas para a implementação/review: (a) revisão de segurança das RPCs e da
reescrita de `is_account_member` (Princípio II); (b) documentação das divergências
de upstream (Princípio V).

## Project Structure

### Documentation (this feature)

```text
specs/008-multi-conta/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — decisões (D1..D9)
├── data-model.md        # Fase 1 — account_members + profiles/accounts
├── quickstart.md        # Fase 1 — como exercitar
├── contracts/           # Fase 1 — RPCs + HTTP
│   ├── membership-rpcs.md
│   └── http-account.md
├── checklists/
│   └── requirements.md  # qualidade da spec (16/16)
└── tasks.md             # /speckit-tasks (ainda não criado)
```

### Source Code (repository root)

```text
supabase/migrations/
├── 508_account_members.sql          # tabela + RLS + backfill + drop idx owner + profiles nullable + invitation.position
├── 509_is_account_member_multi.sql  # reescreve is_account_member (lê account_members)
├── 510_membership_rpcs.sql          # set_active_account; redeem_invitation (ADD); RPCs de membro + guarda último owner
└── 511_handle_new_user_no_account.sql # signup sem conta; provision_company(...) p/ TI

src/
├── lib/auth/
│   ├── account.ts        # getCurrentAccount() — inalterado (lê a conta ATIVA); tratar ramo "sem conta" como sinal p/ UI
│   ├── roles.ts          # inalterado (owner/admin/agent/viewer); position é ortogonal
│   └── memberships.ts    # NOVO: listar vínculos do usuário, trocar conta ativa (chama RPC)
├── app/api/account/
│   ├── memberships/route.ts   # GET lista de empresas do usuário
│   └── switch/route.ts        # POST troca conta ativa
├── components/layout/
│   ├── account-switcher.tsx   # NOVO: seletor no topo (some se 1 empresa)
│   └── no-account.tsx         # NOVO: tela "sem empresa" (FR-023)
├── components/settings/        # gestão de membros: mostrar/atribuir role + position por conta
└── i18n / messages/            # rótulos pt-BR/en (seletor, sem-empresa, cargos, gestão)
```

**Structure Decision**: monorepo web único (Next.js + Supabase). Customização
**aditiva** (novos arquivos `memberships.ts`, `account-switcher.tsx`, `no-account.tsx`,
rotas novas) em vez de reescrever `account.ts`/`roles.ts` — minimiza superfície de
conflito com o upstream (Princípio V/VII). A mudança de schema concentra-se em 4
migrations `508_`+; o núcleo de resolução de conta (`getCurrentAccount`) fica
intocado por construção (a conta ativa continua em `profiles.account_id`).

## Complexity Tracking

> Sem violações de constituição. Nada a justificar.

Nota reversível: se, no futuro, a "conta ativa" precisar virar fronteira de
segurança forçada no banco (ex.: exigir que uma sessão só possa ler a conta ativa),
migra-se para um claim no JWT + política de RLS `account_id = active_claim`, reusando
`account_members` como pertença. Gatilho: requisito de isolamento por-sessão que o
filtro de aplicação não satisfaça. Não é necessário na v1.
