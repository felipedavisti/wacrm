# Quickstart — Verificar a localização pt-BR

Feature: `002-localizacao-pt-br`.

## 1. Verificação de paridade (portão principal)

```bash
npm run test        # inclui o teste de paridade en↔pt — deve passar
npm run typecheck
```

O teste de paridade deve:
- **Passar** quando `en.json` e `pt.json` têm o mesmo conjunto de chaves.
- **Falhar** (com a lista de chaves órfãs) se um locale tiver chave que o outro
  não tem — comprovar introduzindo uma chave só num locale e revertendo.

## 2. Navegação em pt-BR (comportamento)

Com `NEXT_PUBLIC_APP_LOCALE=pt` (ou sem definir, se o padrão já for pt):

1. Rodar `npm run dev` e abrir cada módulo: Login, Dashboard, Inbox, Contatos,
   Pipelines, Broadcasts, Automações, Flows, Settings.
2. Confirmar: todo texto em pt-BR; **nenhum** identificador de chave cru na tela;
   **zero** `MISSING_MESSAGE` no terminal.
3. Foco nas telas que hoje quebram: **Settings** (os papéis via `roles`, e a
   seção `quick-replies`) — devem aparecer com rótulo traduzido.

## 3. Locale padrão

- Subir sem `NEXT_PUBLIC_APP_LOCALE` → interface em pt-BR (FR-006).
- Definir `en` → interface em inglês (o `en.json` continua íntegro).

## 4. Critério de "pronto"

- [ ] `pt.json` com paridade 100% de chaves com `en.json`.
- [ ] Chaves faltantes (`roles`, `Settings.sections.quick-replies`) resolvidas em
      ambos os locales.
- [ ] Zero `MISSING_MESSAGE` navegando todas as telas em pt.
- [ ] Teste de paridade verde e efetivo (falha quando deveria).
- [ ] Locale padrão pt-BR.
