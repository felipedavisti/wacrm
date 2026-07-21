# Tasks: Multi-conta (múltiplos accounts por usuário + troca de empresa)

**Input**: Design de `specs/008-multi-conta/` (spec, plan, research, data-model, contracts, quickstart)

**Feature ativa**: fundação do programa Motor de Leads. Migrations na faixa `508_`+.

**Invariantes** (guiam toda a fase): RLS ancorado em `account` via `is_account_member`
não regride (SC-004) · conta ativa é filtro de visão, não fronteira de segurança ·
`profiles.account_id` = conta ativa (nullable) · pertença em `account_members` ·
último owner sempre preservado · divergências do upstream documentadas (Princípio V) ·
RPCs SECURITY DEFINER revisadas contra vazamento (Princípio II) · i18n pt-BR/en.

**Legenda**: `[P]` = paralelizável (arquivos distintos, sem dependência).

---

## Phase 1: Setup

**Purpose**: preparar terreno; sem mudança de comportamento.

- [x] T001 Confirmar baseline verde (suíte atual + `tsc`/lint) e a última migration aplicada no dev (007 = `507`), fixando `508_` como próxima faixa. **Nota:** baseline = tsc ✅, 714/719 testes ✅; 5 falhas pré-existentes de **locale do ambiente** (currency + weekday em máquina pt-BR, `Intl` divergindo de expectativa en-US) — sem relação com a 008.
- [x] T002 [P] Namespaces i18n `AccountSwitcher` + `NoAccount` criados em `messages/pt-BR.json` e `messages/en.json` (chaves núcleo; mais chaves nas fases das US). Paridade/ICU ✅.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema + fronteira de segurança dos quais TODAS as US dependem.

**⚠️ CRITICAL**: nenhuma US começa antes desta fase fechar.

- [x] T003 Migration `508_account_members.sql`: tabela + RLS + backfill + drop do índice de owner + profiles NULLABLE + `account_invitations.position`. **Extra crítico:** FK `profiles.account_id` mudada de `ON DELETE CASCADE` → **`SET NULL`** (no multi-conta, excluir uma empresa não pode apagar o profile de quem está em outras). Backfill com verificação em DO block (aborta se incompleto) + cinto do owner via `accounts.owner_user_id`. (FR-001..004, FR-009)
- [x] T004 Migration `509_is_account_member_multi.sql`: `is_account_member` lê `account_members` (mesma assinatura/rank/grants; SECURITY DEFINER sem recursão). (FR-003, FR-015)
- [x] T005 Migration `511_handle_new_user_no_account.sql`: signup cria só o profile; `provision_company(nome, primeiro_user)` com grant **apenas service_role** (TI). (FR-019..021)
- [x] T006 [P] Tipos: `SalesPosition` (roles.ts), `AccountMembership`, `Profile.account_id/role` nullable+ressignificados, `AccountMember.position`, `AccountInvitation.position`. Typecheck ✅.
- [x] T007 `getCurrentAccount()`: `NoAccountError` (subclasse de ForbiddenError — rotas seguem 403) + **self-heal**: ponteiro NULL com vínculos existentes → ativa o vínculo mais antigo (cobre empresa ativa excluída/revogada, FR-008/FR-023). Caminho comum sem query extra.
- [x] T008 [P] Testes: 8/8 em `account.test.ts` (NoAccountError sem vínculos; self-heal ativa vínculo mais antigo e grava no profile; profile ausente = Forbidden puro; regressão #294 mantida). Backfill validado por assertions dentro da própria migration 508 (DO block); validação em banco real acontece ao aplicar no dev (checkpoint).

**Checkpoint**: esquema multi-conta no lugar; RLS lê `account_members`; signup não cria mais conta.

---

## Phase 3: User Story 3 — Usuários atuais migram sem perder acesso (Priority: P1)

**Goal**: provar que a migração não tira acesso de ninguém e o isolamento não regride.

**Independent Test**: rodar `508_` sobre snapshot single-account → cada usuário mantém conta/papel; suíte de tenancy verde.

- [x] T009 [US3] Backfill garantido por **assertions dentro da migration 508** (DO block aborta se algum profile ficar sem vínculo) + cinto do owner. **Prova final em banco real: na aplicação ao dev (checkpoint de migrations).** (SC-002)
- [x] T010 [US3] Suíte completa verde pós-mudanças (724/729; 5 falhas pré-existentes de locale). RLS em si não muda de contrato (mesma função/assinatura) — validação de RLS em banco real no checkpoint de dev. (SC-004)

**Checkpoint**: fundação validada — as demais US podem seguir.

---

## Phase 4: User Story 1 — Alternar entre empresas sem deslogar (Priority: P1) 🎯 MVP

**Goal**: seletor de empresa troca o contexto ativo sem novo login; persiste no servidor.

**Independent Test**: usuário com 2 vínculos loga uma vez, troca no seletor e vê os dados da empresa selecionada; ao reabrir, a última selecionada persiste.

- [x] T011 [US1] Migration `510_membership_rpcs.sql` escrita **completa** (troca + convite + membro, para o conjunto SQL 508–511 poder ser aplicado de uma vez): `set_active_account` valida pertença em `account_members` e recusa não-membro (42501); inclui também `redeem_invitation` aditivo, `set_member_role`/`set_member_position`/`remove_account_member` (guarda de owner + reaponta conta ativa do removido) e `transfer_account_ownership` — cobre a parte SQL da T022. (FR-005, FR-006, FR-011)
- [x] T012 [P] [US1] `src/lib/auth/memberships.ts`: `listMemberships` (2 queries planas, sem embed — lição #294; RLS faz o isolamento). (FR-010)
- [x] T013 [US1] `GET /api/account/memberships` — responde inclusive no estado "sem empresa" (`active=null`, lista vazia); ponteiro stale degrada para o 1º vínculo. (FR-010)
- [x] T014 [US1] `POST /api/account/switch` — chama `set_active_account`; 42501→403 (conta forjada nunca ativa); não depende de `getCurrentAccount` (usuário com ponteiro quebrado consegue trocar). (FR-011, FR-015)
- [x] T015 [US1] `account-switcher.tsx` no header: lista empresas com check na ativa; **oculto com ≤1 empresa** (FR-013); troca via `POST /switch`.
- [x] T016 [US1] Zero resíduo na troca: **navegação completa para `/dashboard`** após o switch (o app não tem cache compartilhado/React Query — fetch por componente; reload total é a única garantia de que server components + fetches renascem no contexto novo). Nota: o plano previa React Query; ajustado à realidade do código. (FR-016, SC-006)
- [x] T017 [P] [US1] Rótulos `AccountSwitcher` em pt-BR/en (paridade ✅, criados no T002).
- [x] T018 [US1] Testes: 8/8 nas rotas (`switch`: 401/400/403-não-membro/sucesso com RPC correta; `memberships`: 401/sem-empresa/lista+ativa/ponteiro stale). Persistência entre logins é do servidor (profiles) — prova e2e no checkpoint de dev. (SC-001)

**Checkpoint**: MVP — operar duas empresas e trocar sem re-login funciona.

---

## Phase 5: User Story 2 — Isolamento preservado na troca (Priority: P1)

**Goal**: ver/operar só a empresa ativa; troca não vaza a anterior; acesso a não-membro negado.

**Independent Test**: usuário sem vínculo com X é negado ao acessar X por id/URL; após trocar A→B nenhuma tela mostra dado de A.

- [x] T019 [US2] Isolamento: garantido pelo RLS (`is_account_member` multi — 509) + teste da rota switch (conta forjada → 403). **Prova em banco real no checkpoint de dev** (quickstart cenário 2). (SC-003)
- [x] T020 [US2] Sem resíduo: mecanismo = **navegação completa** pós-troca (T016) — nada da empresa anterior sobrevive em memória por construção. Validação visual no dev. (SC-006)
- [x] T021 [US2] Auditoria: toda escrita resolve `accountId` via `getCurrentAccount()`/`requireRole()` (padrão do hardening 006) — nenhuma rota aceita account de input do cliente sem validar pertença (as que aceitam id, validam por `.eq('account_id')`). A conta ativa É o `ctx.accountId`. (FR-017)

**Checkpoint**: US1 e US2 funcionam; isolamento sob a troca comprovado.

---

## Phase 6: User Story 4 — Conceder e revogar acesso (convite aditivo) (Priority: P2)

**Goal**: convite adiciona um vínculo (sem mover/apagar); admin revoga; último owner protegido.

**Independent Test**: usuário que já pertence a A aceita convite de B → ganha B sem perder A; admin revoga B → B some do seletor.

- [x] T022 [US4] SQL feito na `510_` (ver T011): `redeem_invitation` aditivo + define ativa; `remove_account_member` remove só o vínculo (sem criar conta pessoal), recusa owner (FR-005) e **reaponta a conta ativa do removido** na mesma transação (FR-008); `set_member_role`/`transfer` re-sincronizam denorms. (FR-005..007)
- [x] T023 [US4] Fluxo de aceite ajustado: rota redeem mantida (mesmo nome de RPC; 23505 vira código morto documentado); copy da página `/join` atualizado para a semântica aditiva ("soma às suas empresas; você mantém as anteriores").
- [x] T024 [US4] UI de membros: **roster corrigido para ler de `account_members`** (via rota GET members — antes lia `profiles.account_id`, que agora é só a conta ATIVA e esconderia colega "trocado" para outra empresa). UI existente (papel/remoção/convites) preservada. **+ correções de RLS na 508**: `account_members_select` = qualquer membro da conta; `profiles_select` = "compartilha ≥1 empresa comigo". (FR-007, FR-012, FR-013)
- [x] T025 [P] [US4] Rótulos `Settings.positions` (cargo) em pt-BR/en; paridade ✅.
- [x] T026 [US4] Comportamento das RPCs é SQL (aditivo/guarda de owner/reaponta) — testado no aceite/remoção reais do **checkpoint de dev** (quickstart cenário 3); guardas revisadas na T033. (FR-005, FR-008)

**Checkpoint**: pertença gerenciável por convite/revogação, sem perder o modelo single-account.

---

## Phase 7: User Story 5 — Papel/cargo por vínculo (Priority: P2)

**Goal**: mesma pessoa com papéis diferentes por empresa; cargos SDR/closer/vendedor como `position`; permissões refletem o papel da conta ativa.

**Independent Test**: usuário admin em A e agent em B → ações administrativas só aparecem com A ativa.

- [x] T027 [P] [US5] `SalesPosition` + `SALES_POSITIONS` + `isSalesPosition` em `roles.ts` (ortogonais ao rank de permissão). (FR-022)
- [x] T028 [US5] `position` de ponta a ponta: RPC `set_member_position` (510) · PATCH members aceita `{role?, position?}` (tri-state: ausente/null/valor) · select de cargo na members-tab (admin+; chip read-only p/ demais) · convite carrega `position` (dialog + POST invitations + coluna 508 + copiado no aceite). (FR-002, FR-022)
- [x] T029 [US5] Gates seguem o papel da conta **ativa** por construção: `requireRole`/`useAuth` leem o denorm da ativa, re-sincronizado por todas as RPCs (troca/aceite/mudança de papel). Validação visual (admin em A, agent em B) no checkpoint de dev. (FR-018)

**Checkpoint**: papel e cargo por vínculo funcionando.

---

## Phase 8: Polish & Cross-Cutting

- [x] T030 Tela `no-account.tsx` (aguardar convite/TI + logout; sem affordance de criar empresa) + gate no `dashboard-shell`: ponteiro NULL → consulta memberships; **com vínculos → self-heal client-side** (ativa o 1º e recarrega); sem nenhum → tela neutra. Auto-reset quando o profile ganhar conta. (FR-023)
- [x] T031 [P] Coberto: rota memberships responde `null+[]` no estado sem-empresa (teste ✅); signup sem conta é a 511 (validação no dev). (FR-021, FR-023)
- [x] T032 Divergências 508–511 documentadas em `docs/upstream-sync.md` (seção nova) + comentários em cada migration; provisionamento TI já no `quickstart.md`. (Princípio V)
- [x] T033 **Revisão de segurança** (Princípio II) feita — **2 achados ALTOS, corrigidos na 508**: (1) policies de escrita de `account_members` permitiriam autopromoção a owner via UPDATE direto → escrita agora é deny-by-default (só RPCs SECURITY DEFINER); (2) `profiles.account_id/account_role` eram editáveis pelo próprio usuário (escalação **pré-existente da 017**: o is_account_member antigo lia esse campo!) → trigger `guard_profile_account_fields` bloqueia mudança fora de SECURITY DEFINER; self-heal do `getCurrentAccount` migrado para a RPC. RPCs/rotas/RLS restantes revisadas sem achados. Registrado em `docs/upstream-sync.md`.
- [x] T034 [P] Portão de i18n: paridade pt-BR/en + ICU ✅ (roda na suíte; 4/4).
- [x] T035 Validação no dev feita pelo usuário (migrations 508–512 aplicadas; backfill 4/4; provision da 2ª empresa; troca + **isolamento confirmado** após o hotfix 512). Code review manual da diff completa: sem bugs remanescentes; build+typecheck+suíte ✅. **Hotfix 512** (achado no teste): RLS de domínio exige conta ATIVA — corrigiu a mistura de empresas nas queries client-side. (`/code-review high` independente fica opcional ao usuário.)

---

## Dependencies & Execution Order

- **Phase 1 (Setup)**: sem dependências.
- **Phase 2 (Foundational)**: bloqueia TODAS as US. T003 → T004 (is_account_member depende de account_members) → T005/T006/T007. T008 valida T003.
- **Phase 3 (US3)**: depende da Foundational; valida a migração antes de empilhar features.
- **Phase 4 (US1)**: depende da Foundational. T011 (RPC) → T012 → T013/T014 → T015 → T016. É o MVP.
- **Phase 5 (US2)**: depende da US1 (a invalidação T016) e da Foundational.
- **Phase 6 (US4)**: depende da Foundational; T022 (RPCs) → T023/T024. Compartilha a UI de membros com a US5.
- **Phase 7 (US5)**: depende da US4 (UI de membros).
- **Phase 8 (Polish)**: T030 precisa da Foundational (T005/T007); T033/T035 por último.

### Ordem recomendada de entrega

**MVP** = Setup + Foundational + US3 + US1 (troca real entre duas empresas, com migração provada). Depois US2 (isolamento sob troca), US4 (convite/revogação), US5 (papel/cargo), e o Polish.

### Oportunidades de paralelismo

- T002/T006/T008 [P] na Foundational.
- T012/T017 [P] na US1; T025 [P] na US4; T027 [P] na US5; T031/T034 [P] no Polish.
- Após a Foundational, US1 e US4 podem correr em paralelo (times distintos) — só a UI de membros (US4/US5) e a de seletor (US1) tocam áreas diferentes.

---

## Notes

- Tests incluídos deliberadamente: SC-004 (tenancy verde) e a sensibilidade de segurança das RPCs exigem cobertura.
- `[P]` = arquivos distintos, sem dependência.
- Commit após cada task ou grupo lógico; parar nos checkpoints para validar a US isoladamente.
- Duas obrigações constitucionais viram tarefas explícitas: T033 (revisão de segurança, Princípio II) e T032 (divergências de upstream, Princípio V).
