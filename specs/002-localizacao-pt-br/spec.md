# Especificação de Funcionalidade: Localização pt-BR

**Feature Branch**: `002-localizacao-pt-br`

**Criada em**: 2026-07-16

**Status**: Rascunho

**Entrada**: O produto da Fnx será em português (pt-BR), mas só existe
`messages/en.json`. Além disso, o código referencia chaves de tradução que nem
o `en.json` tem — gerando erros de tradução em runtime.

> **Contexto do fonte**: o app já está **totalmente cabeado para i18n** — 99
> chamadas de `useTranslations`/`getTranslations` em 73 arquivos, com o
> dicionário em `messages/en.json` (~74 KB). Ou seja: os textos **já estão
> externalizados**. Esta feature é **traduzir o dicionário** para pt-BR e
> corrigir chaves faltantes — não é caçar strings hardcoded. Biblioteca:
> `next-intl`; locale controlado por `NEXT_PUBLIC_APP_LOCALE`; `src/i18n/request.ts`
> hoje cai em `en` quando o dicionário do locale não existe.

## Cenários de Usuário & Testes *(obrigatório)*

### User Story 1 - Interface em português para o operador (Priority: P1) 🎯 MVP

Um agente da vitalmed (ou de qualquer cliente Fnx) abre o CRM e vê **todas as
telas em português** — inbox, contatos, pipelines, broadcasts, automações,
flows, settings, dashboard, login. Nada em inglês, nada de chave crua na tela.

**Por que esta prioridade**: é a razão da feature. O produto é vendido em
português; interface em inglês é inaceitável para o operador final.

**Teste independente**: com `locale = pt`, navegar cada módulo e confirmar que
todo texto visível está em pt-BR, sem sobrar termo em inglês nem identificador
de chave (ex.: `Settings.sections.inbox`).

**Acceptance Scenarios**:

1. **Given** `locale = pt`, **When** o operador abre qualquer módulo do
   dashboard, **Then** todos os rótulos, botões, títulos e mensagens aparecem em
   pt-BR.
2. **Given** um texto com variável/plural (ex.: contagem de itens), **When**
   renderizado em pt-BR, **Then** a interpolação e o plural seguem a gramática
   portuguesa.
3. **Given** o `en.json` como fonte, **When** o `pt.json` é criado, **Then** ele
   tem **exatamente as mesmas chaves** (nenhuma a mais, nenhuma a menos).

---

### User Story 2 - Zero erro de tradução em runtime (Priority: P1)

Hoje o console/terminal loga `MISSING_MESSAGE` para chaves que o **código
referencia mas o `en.json` não tem** — por exemplo `roles` e
`Settings.sections.quick-replies`. Isso aparece como chave crua na tela e como
erro no log. Depois desta feature, **nenhuma** chave referenciada pelo código
fica sem tradução, em nenhum locale.

**Por que esta prioridade**: é um bug **já ativo** (visto no terminal), herdado
do upstream — o `en.json` está incompleto em relação ao que o código usa.
Corrigir é pré-requisito de qualquer tela consistente.

**Teste independente**: fazer um levantamento das chaves usadas pelo código
(`t('...')` / `useTranslations('ns')`) e confirmar que **todas** existem em
`en.json` e `pt.json`; navegar as telas afetadas (Settings) sem `MISSING_MESSAGE`.

**Acceptance Scenarios**:

1. **Given** o código referencia `roles` e `Settings.sections.quick-replies`,
   **When** as telas que os usam são abertas, **Then** os rótulos aparecem
   traduzidos e **não há** `MISSING_MESSAGE` no log.
2. **Given** qualquer chave referenciada no código, **When** o app roda em `pt`
   ou `en`, **Then** ela resolve para um texto (nunca a chave crua).

---

### User Story 3 - pt-BR como padrão e consistência garantida (Priority: P2)

A Fnx quer que novas instalações já venham em português, e que o time (3
pessoas) **não deixe os dicionários divergirem** quando adicionar chaves novas.

**Por que esta prioridade**: sustenta a qualidade no tempo (Princípio VII). Sem
uma verificação, o `pt.json` e o `en.json` inevitavelmente divergem e o bug da
US2 volta.

**Teste independente**: rodar a verificação automatizada de paridade de chaves e
confirmar que ela **falha** quando um locale tem chave que o outro não tem, e
**passa** quando estão em paridade.

**Acceptance Scenarios**:

1. **Given** o locale padrão, **When** uma instalação nova sobe sem configurar
   `NEXT_PUBLIC_APP_LOCALE`, **Then** a interface aparece em pt-BR.
2. **Given** um dev adiciona uma chave só no `en.json`, **When** a verificação de
   paridade roda, **Then** ela falha apontando a chave ausente no `pt.json`.

---

### Edge Cases

- **Chave existe em `en` mas não em `pt` (ou vice-versa)**: a verificação de
  paridade (US3) DEVE detectar e falhar. Em runtime, o fallback para `en`
  continua evitando tela quebrada, mas não é solução — a paridade é.
- **Variáveis e plurais**: strings com `{count}`/ICU MessageFormat DEVEM ser
  traduzidas preservando os placeholders e as regras de plural do pt-BR.
- **Termos que não se traduzem**: marcas e termos de produto (WhatsApp, CRM,
  etc.) permanecem no original.
- **Chave referenciada pelo código e ausente em ambos os locales**: é o bug da
  US2; DEVE ser adicionada aos dois dicionários.

## Requirements *(obrigatório)*

### Functional Requirements

- **FR-001**: O sistema DEVE ter um dicionário `messages/pt.json` com tradução
  pt-BR de **todo** o conteúdo de `messages/en.json`.
- **FR-002**: `pt.json` e `en.json` DEVEM ter **conjuntos de chaves idênticos**
  (paridade total).
- **FR-003**: Toda chave de tradução **referenciada pelo código** DEVE existir
  em ambos os locales — incluindo as hoje ausentes (`roles`,
  `Settings.sections.quick-replies`, e quaisquer outras encontradas no
  levantamento).
- **FR-004**: As chaves faltantes DEVEM ser adicionadas **também ao `en.json`**
  (o bug está no upstream, não só na falta do pt).
- **FR-005**: Placeholders de interpolação e regras de plural (ICU) DEVEM ser
  preservados na tradução, seguindo a gramática pt-BR.
- **FR-006**: O locale padrão DEVE ser pt-BR quando `NEXT_PUBLIC_APP_LOCALE` não
  estiver definido.
- **FR-007**: DEVE existir uma verificação automatizada que falha quando os
  dicionários divergem em chaves (previne regressão — Princípio VII).
- **FR-008**: Marcas/termos de produto (WhatsApp, CRM, nomes próprios) DEVEM
  permanecer no original.
- **FR-009**: A mudança DEVE ser aditiva (novo `pt.json`; correções pontuais no
  `en.json`), sem tocar em componentes nem em lógica — Princípio V.

### Key Entities *(inclui dados)*

- **Dicionário de locale**: um arquivo JSON por idioma (`en.json`, `pt.json`)
  com a mesma árvore de chaves; folhas são strings (possivelmente com
  placeholders/ICU).
- **Chave de tradução**: caminho namespaced (ex.: `Settings.sections.inbox`)
  referenciado no código via `useTranslations`/`t`.
- **Verificação de paridade**: rotina que compara os conjuntos de chaves entre
  locales (e, idealmente, contra as chaves usadas no código).

## Success Criteria *(obrigatório)*

### Measurable Outcomes

- **SC-001**: 100% das chaves de `en.json` têm correspondente em `pt.json`
  (paridade = 100%).
- **SC-002**: Navegando **todas** as telas com `locale = pt`, ocorrem **zero**
  erros `MISSING_MESSAGE`.
- **SC-003**: As chaves hoje ausentes (`roles`, `Settings.sections.quick-replies`)
  resolvem para texto traduzido em ambos os locales.
- **SC-004**: A verificação de paridade **falha** ao introduzir divergência e
  **passa** quando os dicionários estão alinhados.
- **SC-005**: Instalação nova, sem `NEXT_PUBLIC_APP_LOCALE`, exibe a interface em
  pt-BR.

## Assumptions

- O app já roteia **todo** texto de usuário por `next-intl` (99 usos em 73
  arquivos). Se o levantamento revelar strings hardcoded relevantes, elas
  entram como itens pontuais — mas a premissa é que são exceção, não regra.
- A tradução é para **pt-BR** (não pt-PT), com tom profissional adequado a um
  CRM de atendimento (incl. área de saúde).
- Sem novos idiomas nesta feature (só pt-BR + o en existente).
- Sem mudança de schema, sem mudança de UI estrutural (só textos).

## Dependencies

- Alinhada com a diretriz de projeto "tudo em português" (memória `language-pt`)
  e com a Constitution (Princípios V e VII).
- Independente da 001 (engine-send-base) e das demais specs.
