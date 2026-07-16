# Quickstart — Verificar o endurecimento service_role

Feature: `006-hardening-service-role`.

## 1. Testes de isolamento

```bash
npm run test        # inclui os testes de isolamento por caminho
npm run typecheck
```

Cada teste de isolamento deve **falhar** se o filtro `account_id` for removido do
caminho correspondente (verificar removendo temporariamente e revertendo).

## 2. Inventário

- Abrir `docs/service-role-inventory.md` e confirmar que **todo** caminho
  service_role está listado com seu invariante de isolamento (filtro `account_id`
  ou `phone_number_id` único).

## 3. Guarda

- Chamar um caminho scoped sem `account_id` → a guarda recusa (não roda sem filtro).

## 4. Critério de "pronto"

- [ ] Inventário completo no repo.
- [ ] Teste de isolamento por caminho (engines, webhook, api-keys, crons, envio).
- [ ] Guarda de escopo onde o filtro era implícito.
- [ ] Zero regressão funcional; suíte verde.
