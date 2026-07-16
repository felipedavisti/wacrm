# Tarefas: Localização pt-BR

**Feature**: `002-localizacao-pt-br` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md)

Abordagem: a **verificação de paridade vem primeiro** — ela fica vermelha e guia
a tradução até ficar verde. Mudança aditiva (novo `pt.json`; correções pontuais
no `en.json`); sem tocar em componentes (exceto se a Decisão 1 do research
escolher corrigir a referência `roles`).

**Invariantes globais**: `en.json` e `pt.json` com chaves idênticas · zero
`MISSING_MESSAGE` em runtime · placeholders ICU/plural preservados · marcas no
original · sem mudança de schema/UI estrutural.

**Fora de escopo**: novos idiomas; externalizar strings hardcoded; formatação de
data/número.

**Legenda**: `[P]` = paralelizável.

---

## Fase 1 — Setup

- [ ] T001 Baseline: rodar `npm run test` e `npm run typecheck` e registrar verde.

---

## Fase 2 — Fundacional: verificação de paridade (bloqueia US1/US2/US3)

- [ ] T002 Criar o teste de paridade de chaves en↔pt em `messages/parity.test.ts` (ou `src/i18n/parity.test.ts`): carrega os dois dicionários, achata em dot-paths, e falha listando chaves órfãs de cada lado. Inclui um caso que prova que o teste FALHA quando há divergência. (FR-002, FR-007)
- [ ] T003 Levantamento fino: gerar a lista completa de chaves referenciadas pelo código (`useTranslations`/`t`) e confirmar quais faltam no `en.json` além das já conhecidas (`roles`, `Settings.sections.quick-replies`). Registrar o resultado no PR.

---

## Fase 3 — US1: Interface em português (P1) 🎯 MVP

**Meta**: `pt.json` completo; operador vê tudo em pt-BR.

**Teste independente**: navegar cada módulo com `locale=pt` — tudo em português, sem chave crua.

- [ ] T004 [US1] Criar `messages/pt.json` traduzindo TODO o `messages/en.json` para pt-BR, preservando a árvore de chaves, os placeholders ICU e as regras de plural. Tom profissional de CRM; marcas no original (Decisão 4). (FR-001, FR-005, FR-008)
- [ ] T005 [US1] Rodar o teste de paridade (T002) e iterar o `pt.json` até **verde** (paridade 100% com `en.json`). (FR-002)
- [ ] T006 [P] [US1] Revisão de tradução dos módulos de maior visibilidade (Inbox, Contacts, Pipelines, Broadcasts, Dashboard) — checar naturalidade e termos de domínio.
- [ ] T007 [P] [US1] Revisão de tradução dos demais (Settings, Automations, Flows, Sidebar/Header/Login) — idem.

---

## Fase 4 — US2: Zero erro de tradução em runtime (P1)

**Meta**: nenhuma chave referenciada pelo código fica sem tradução; some o `MISSING_MESSAGE`.

- [ ] T008 [US2] Adicionar o namespace `roles` (owner/admin/agent/viewer) a `en.json` e `pt.json` — OU (conforme Decisão 1 do research, se o time preferir) corrigir `src/components/settings/settings-overview.tsx:43` para usar `Settings.roles`. Registrar a opção escolhida. (FR-003, FR-004)
- [ ] T009 [US2] Adicionar `Settings.sections.quick-replies` (rótulo "Respostas rápidas") a `en.json` e `pt.json`, além de quaisquer outras faltantes achadas em T003. (FR-003, FR-004)
- [ ] T010 [US2] Rodar `npm run dev` com `locale=pt`, abrir a tela de **Settings** e confirmar: papéis e a seção quick-replies com rótulo; **zero** `MISSING_MESSAGE` no terminal. (SC-002, SC-003)

---

## Fase 5 — US3: Padrão pt-BR + consistência (P2)

**Meta**: instalação nova já em pt-BR; paridade protegida.

- [ ] T011 [US3] Tornar pt-BR o locale padrão quando `NEXT_PUBLIC_APP_LOCALE` não estiver definido: ajustar a resolução de locale (env + `src/i18n/request.ts`) e documentar `pt` como padrão no `.env.local.example`. (FR-006, SC-005)
- [ ] T012 [US3] Confirmar que o teste de paridade (T002) roda no CI/`npm run test` como portão — falha bloqueia o build. (FR-007, SC-004)

---

## Fase 6 — Polimento & Verificação

- [ ] T013 Rodar `npm run test` (incl. paridade) + `npm run typecheck` — verde/limpo.
- [ ] T014 [P] Navegar TODOS os módulos com `locale=pt` e confirmar zero `MISSING_MESSAGE` e nenhum texto em inglês (quickstart §2). (SC-001, SC-002)
- [ ] T015 Passar o `code-review` na diff (foco: paridade efetiva, nenhuma regressão de placeholder/plural).

---

## Dependências & Ordem

- **T001** antes de tudo.
- **T002** (paridade) é fundacional — vem antes de traduzir (guia o trabalho).
- **US1**: T004 → **T005** (verde) → T006/T007 (revisão, `[P]`).
- **US2**: T008/T009 (as faltantes) → **T010** (confirmar sem MISSING_MESSAGE). Pode andar junto com US1.
- **US3**: T011/T012 depois da US1/US2.
- **Fase 6** por último.

## Estratégia de entrega

- **MVP = US1 + US2** (T001–T010): produto em pt-BR e sem erro de tradução em
  runtime (conserta o bug ativo). Já entregável.
- **US3** fixa o padrão e a proteção contra regressão.

## Oportunidades de paralelismo

- T006 ∥ T007 (revisão de tradução por área, arquivos distintos).
- T008/T009 podem andar junto com T004 (namespaces distintos).
