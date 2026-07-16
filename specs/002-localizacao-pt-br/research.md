# Fase 0 — Pesquisa & Decisões de Design

Feature: Localização pt-BR (`002-localizacao-pt-br`).

## Levantamento de chaves (código vs. dicionário)

Namespaces usados por `useTranslations` no código (13 distintos no top-level):
`LoginPage, Sidebar, Header, ModeToggle, Dashboard, Inbox, Contacts, Pipelines,
Broadcasts, Automations, Flows, Settings` + **`roles`**.

Top-level presentes em `en.json`: os 12 primeiros. **Ausente: `roles`.**

Lacunas confirmadas (código referencia, dicionário não tem):
- **`roles`** (top-level) — `src/components/settings/settings-overview.tsx:43`.
  O restante do app usa `Settings.roles` (presente). É uma referência divergente.
- **`Settings.sections.quick-replies`** — sub-chave ausente em `Settings.sections`.

> Nota: este levantamento por namespace top-level pega lacunas grandes. Lacunas
> de sub-chave (como `quick-replies`) só o levantamento fino + a verificação de
> paridade/uso pegam por completo — por isso a verificação (FR-007) é entregue
> junto e serve como a auditoria definitiva.

## Decisão 1 — Como resolver o namespace `roles`

**Decisão (recomendada)**: adicionar um namespace top-level `roles` a `en.json`
e `pt.json`, com os rótulos de papel (owner/admin/agent/viewer). **Aditivo,
não toca componente** — honra o FR-009.

**Alternativa**: corrigir `settings-overview.tsx:43` para `Settings.roles`
(reusa o namespace existente, remove a duplicação). Mais limpo semanticamente,
mas toca um componente (contra o FR-009). Registrar para o time decidir; se
escolhida, vira uma tarefa pontual e some a duplicação `roles` ≈ `Settings.roles`.

## Decisão 2 — Verificação de paridade (FR-007)

**Decisão**: teste Vitest que carrega os dicionários, achata as chaves (dot-path)
e falha se os conjuntos de `en` e `pt` diferirem — listando as chaves órfãs de
cada lado. Roda no CI (portão de build herdado do upstream).

**Justificativa**: é a rede que impede a regressão da US2/US3. Escrita **antes**
da tradução, ela guia o trabalho (fica vermelha até o `pt.json` estar completo).

**Alternativa considerada**: só revisão manual — rejeitada, diverge com o tempo
(Princípio VII).

## Decisão 3 — Locale padrão pt-BR (FR-006)

**Decisão**: o padrão quando `NEXT_PUBLIC_APP_LOCALE` não está setado passa a ser
`pt`. Ajustar onde o locale é resolvido (env + `src/i18n/request.ts`). O
`.env.local.example` documenta `pt` como padrão.

**Justificativa**: produto pt-BR (diretriz de projeto). O `en` continua
disponível e como fallback de segurança.

## Decisão 4 — Estilo da tradução

**Decisão**: pt-BR profissional, tom de CRM de atendimento; tratamento neutro
(evitar "você/tu" inconsistente — padronizar em "você"). Marcas e termos de
produto (WhatsApp, CRM, etc.) permanecem no original. Preservar placeholders
ICU e regras de plural do português.

## Fora de escopo (registrado)

- Novos idiomas além de pt/en.
- Auditar/externalizar strings hardcoded (premissa: são exceção; se o
  levantamento fino achar alguma relevante, vira item pontual).
- Formatação de data/número além do que o next-intl já provê.
