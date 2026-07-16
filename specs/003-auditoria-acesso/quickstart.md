# Quickstart — Verificar a atribuição de autor

Feature: `003-auditoria-acesso`.

## 1. Testes automatizados

```bash
npm run test        # inclui send-message.test com casos de sender_id
npm run typecheck
```

Cobertura a existir:
- Envio de agente com `senderId` → linha `messages` com `sender_id` = agente.
- Envio sem `senderId` (API) → `sender_id` nulo.
- (Se prático) teste garantindo que `ApiMessage` não inclui `sender_id`.

## 2. Verificação de comportamento (dev, Supabase cloud)

1. Com dois logins de agente diferentes na mesma conta, cada um envia uma
   mensagem na mesma conversa.
2. Conferir no banco (ou na inbox): cada mensagem tem `sender_id` do agente
   correto; `sender_type='agent'`.
3. Disparar um flow/automação → mensagem com `sender_type='bot'`, `sender_id`
   nulo.
4. Abrir a inbox: cada mensagem de saída mostra "enviado por \<agente\>";
   mensagens de bot/cliente não mostram autor; nada quebra.
5. Chamar `GET /api/v1/conversations/{id}/messages` → resposta **sem** campo
   `sender_id`.

## 3. Critério de "pronto"

- [ ] Envio de agente grava `sender_id`; bot/customer/API ficam nulos.
- [ ] Inbox exibe o autor; degrada sem quebrar quando não há autor.
- [ ] API pública não expõe `sender_id`.
- [ ] `npm run test` verde; `npm run typecheck` limpo.
- [ ] Sem migration.
