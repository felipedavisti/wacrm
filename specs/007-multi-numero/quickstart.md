# Quickstart — Verificar múltiplos números

Feature: `007-multi-numero`. (Design: `docs/spec-multi-numero.md`.)

## 1. Migrations + testes

```bash
# aplicar as migrations 50x_ no dev
npm run test
npm run typecheck
```

## 2. Comportamento (dev, com 2 números de teste)

1. **Cadastro**: adicionar 2 números na conta (idealmente WABAs/Apps diferentes)
   → ambos listados e conectados.
2. **Threads separadas**: o mesmo contato manda mensagem nos 2 números → 2
   threads distintas (não fundem).
3. **Resposta pelo número certo**: responder em cada thread → sai pelo número
   correspondente.
4. **Webhook multi-app**: eventos assinados por 2 Apps → ambos aceitos;
   assinatura inválida → 401.
5. **Templates**: seletor mostra só os da WABA do número.
6. **Broadcast**: escolher número no wizard → templates filtrados → disparo cai
   naquele número.
7. **Saída fria**: iniciar conversa com contato novo → escolher número → thread
   nasce nele.

## 3. Critério de "pronto"

- [ ] 2+ números operando (receber/enviar por cada).
- [ ] Threads separadas por número; sem fusão (índice atualizado).
- [ ] Resposta sai pelo número da thread.
- [ ] Webhook multi-app autentica (fail-closed).
- [ ] Templates por WABA; broadcast e saída fria escolhem número.
- [ ] Migrations `500_`+; divergências documentadas.
