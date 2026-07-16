# Fase 1 — Modelo de Dados (entidades leves)

Feature: `002-localizacao-pt-br`. **Sem banco.** As "entidades" são os
dicionários de tradução.

## Dicionário de locale (`messages/<locale>.json`)

- Árvore JSON de namespaces → sub-chaves → **string** (folha).
- Folhas podem conter placeholders ICU (`{name}`) e blocos de plural.
- Invariante central: **`en.json` e `pt.json` têm o mesmo conjunto de caminhos
  de chave** (dot-paths). Diferença de chaves = falha na verificação de paridade.

## Chave de tradução

- Caminho namespaced (ex.: `Settings.sections.inbox`, `roles.owner`).
- Referenciada no código por `useTranslations('<namespace>')` + `t('<sub>')`.
- Invariante: toda chave referenciada pelo código existe em **ambos** os locales.

## Verificação de paridade

- Entrada: os dicionários carregados.
- Saída: sucesso se conjuntos de dot-paths iguais; senão, lista as chaves
  presentes só em `en` e só em `pt`.
- (Opcional, extensão futura) cruzar com as chaves usadas no código.

## Correções de chave conhecidas (a aplicar em ambos os locales)

| Chave | Situação | Ação |
|---|---|---|
| `roles` (top-level) | ausente; usada em `settings-overview.tsx:43` | adicionar (Decisão 1) |
| `Settings.sections.quick-replies` | ausente em `Settings.sections` | adicionar rótulo |
