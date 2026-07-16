# Contrato: propagação de `senderId`

Feature: `003-auditoria-acesso`.

## Core de envio (`send-message.ts`)

```ts
export interface SendMessageParams {
  // ...campos existentes...
  /** Id do agente humano que originou o envio. null para bot/API sem humano.
   *  Gravado em messages.sender_id. */
  senderId?: string | null
}
```

No insert de `messages` (hoje `send-message.ts:455`):

```ts
.insert({
  conversation_id: conversationId,
  sender_type: 'agent',
  sender_id: senderId ?? null,   // ← ADICIONADO
  // ...resto inalterado...
})
```

## Chamadores

| Chamador | Passa `senderId` |
|---|---|
| `POST /api/whatsapp/send` (dashboard) | `user.id` de `auth.getUser()` |
| `POST /api/v1/messages` (API pública) | `null` (sem agente humano) |
| `resolve-conversation` / outros caminhos de agente | id do agente, se houver |

## Invariante da API pública

`ApiMessage` **não** expõe `sender_id`. Nenhum campo novo é adicionado ao
serializer. (Guardar por teste, se prático.)
