# Plano de Implementação: Localização pt-BR

**Branch**: `002-localizacao-pt-br` | **Data**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

## Resumo

Criar `messages/pt.json` como tradução completa de `messages/en.json`, corrigir
as chaves referenciadas pelo código que faltam nos dicionários, tornar pt-BR o
locale padrão, e adicionar uma verificação de paridade de chaves que impede
regressão. Sem tocar em componentes (app já é 100% i18n-wired); mudança aditiva.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6, Next.js 16, next-intl
**i18n**: `next-intl`; dicionários em `messages/*.json`; carregados por
`src/i18n/request.ts` (fallback para `en`); locale via `NEXT_PUBLIC_APP_LOCALE`
**Cobertura atual**: 99 `useTranslations`/`getTranslations` em 73 arquivos —
textos já externalizados. Só existe `messages/en.json` (~74 KB).
**Lacunas confirmadas** (código referencia, dicionário não tem):
- `roles` (top-level) — usado em `src/components/settings/settings-overview.tsx:43`
- `Settings.sections.quick-replies` — sub-chave ausente em `Settings.sections`
**Testes**: Vitest. Adicionar teste de paridade de chaves entre locales.
**Armazenamento/DB**: nenhum. **UI estrutural**: nenhuma mudança (só textos).

## Constitution Check

| Princípio | Avaliação |
|---|---|
| **Idioma pt-BR** (diretriz de projeto) | ✅ É a razão da feature. |
| **V — Disciplina de upstream** | ✅ Aditivo: novo `pt.json`; correções pontuais no `en.json`. Baixo conflito. Ver decisão sobre `roles` no research (opção que evita tocar componente). |
| **VII — Manutenibilidade** | ✅ A verificação de paridade impede os dicionários de divergirem no tempo. |
| **I/II/III/IV** | ➖ Sem impacto (só textos de interface; sem dado, sem segurança, sem schema). |

**Resultado**: PASSA. Sem violação.

## Estrutura do Projeto

### Documentação (esta feature)

```text
specs/002-localizacao-pt-br/
├── spec.md
├── plan.md
├── research.md          # levantamento de chaves + decisões
├── data-model.md        # dicionários (entidades leves)
├── quickstart.md        # verificação
└── tasks.md             # /speckit-tasks
```

### Código-fonte

```text
messages/
├── en.json              # CORRIGIDO — adicionar chaves faltantes (roles, quick-replies, ...)
└── pt.json              # NOVO — tradução pt-BR completa (mesmas chaves)

src/
├── i18n/request.ts      # locale padrão pt (ver research)
└── (nenhum componente alterado — só se a decisão do research escolher corrigir a referência 'roles')

scripts/ (ou test)
└── verificação de paridade de chaves en↔pt  # NOVO (FR-007)
```

**Decisão de estrutura**: manter os dicionários em `messages/` (convenção do
next-intl no projeto). A verificação de paridade fica como teste Vitest (roda no
CI, alinhado ao portão de qualidade herdado do upstream).

## Complexity Tracking

> Sem violação de Constitution Check.

## Fases

- **Fase 0 (research.md)**: levantamento completo das chaves usadas vs. presentes;
  decisão sobre `roles` (adicionar namespace vs. corrigir a referência); tom/estilo
  da tradução; forma da verificação de paridade.
- **Fase 1 (data-model + quickstart)**: estrutura dos dicionários e roteiro de
  verificação. Atualizar ponteiro em `CLAUDE.md`.
- **Fase 2 (/speckit-tasks)**: tarefas ordenadas.
