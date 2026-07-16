# Quickstart — Verificar a janela de 24h

Feature: `005-janela-24h`.

## 1. Migration + testes

```bash
# aplicar a migration 500_ no projeto de dev (supabase db push ou SQL editor)
npm run test
npm run typecheck
```

Cobertura a existir:
- `isWindowOpen`: aberta (<24h), fechada (>24h), fechada (null/sem entrada).
- `send-message`: não-template fora da janela → `window_expired` sem chamar Meta;
  template fora da janela → passa; mapeamento de 131047 → mesma mensagem.

## 2. Comportamento (dev)

1. Conversa com última entrada há <24h → enviar texto: sucesso.
2. Conversa com última entrada há >24h (ou sem entrada) → enviar texto: erro
   claro "janela expirada — envie template"; enviar template: sucesso.
3. Abrir a conversa fora da janela → composer avisa e oferece template **antes**
   de digitar.
4. Cliente manda mensagem → janela reabre; composer volta ao normal sem
   recarregar.

## 3. Critério de "pronto"

- [ ] `last_inbound_at` rastreada pelo webhook; backfill aplicado.
- [ ] Texto livre fora da janela recusado localmente com mensagem clara.
- [ ] Template sempre permitido; 131047 mapeado (backstop).
- [ ] Composer avisa proativamente; reabre em real-time.
- [ ] Rótulos pt/en; testes verdes. Migration na faixa 500_.
