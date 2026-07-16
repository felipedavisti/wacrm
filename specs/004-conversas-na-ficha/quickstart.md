# Quickstart — Verificar Conversas na ficha

Feature: `004-conversas-na-ficha`.

## 1. Testes / typecheck

```bash
npm run test
npm run typecheck
```

## 2. Comportamento (dev, Supabase cloud)

1. Abrir a ficha de um contato **com** conversa → a seção "Conversas" mostra a
   conversa com status, prévia e data.
2. Clicar → a inbox abre naquela conversa (`/inbox?c=<id>`).
3. Abrir a ficha de um contato **sem** conversa → estado vazio, sem erro.
4. (Multi-número, quando existir) contato com 2 conversas em números diferentes →
   as duas aparecem, identificando o número.

## 3. Critério de "pronto"

- [ ] Seção "Conversas" na ficha, account-scoped, ordenada por atividade.
- [ ] Link abre a conversa certa na inbox.
- [ ] Estado vazio sem erro.
- [ ] Suporta N conversas.
- [ ] Rótulos em pt/en; `npm run test`/`typecheck` verdes. Sem migration.
