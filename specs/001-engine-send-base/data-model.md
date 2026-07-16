# Fase 1 — Modelo de Dados (entidades internas)

Feature: `001-engine-send-base`. **Não há alteração de schema de banco.** As
"entidades" abaixo são tipos internos do módulo `engine-send-base.ts` — o
contrato completo está em [contracts/engine-send-base.md](./contracts/engine-send-base.md).

## Tabelas de banco tocadas em runtime (inalteradas)

| Tabela | Uso | Mudança |
|---|---|---|
| `contacts` | ler `id, phone` por `(id, account_id)`; atualizar `phone` corrigido | nenhuma |
| `whatsapp_config` | ler config por `account_id` (dentro do resolver) | nenhuma |
| `messages` | inserir a mensagem enviada (`sender_type='bot'`, ...) | nenhuma |
| `conversations` | atualizar `last_message_text/at`, `updated_at` | nenhuma |

## Entidades internas (tipos TS)

### `ResolvedSendConfig`
- `phoneNumberId: string` — id do número na Meta
- `accessToken: string` — token **já descriptografado**
- *(futuro)* `whatsappConfigId?: string`

### `ResolveConfig` (a costura)
- Função `(ctx: { db, accountId, conversationId, contactId }) → Promise<ResolvedSendConfig>`
- Implementação de hoje: `resolveConfigByAccount` — `whatsapp_config` por
  `account_id` com `.single()` + `decrypt(access_token)`.
- Implementação futura (multi-número, **outra spec**): por `conversationId`.

### `DoMetaSend`
- Função `({ to, phoneNumberId, accessToken }) → Promise<{ messageId }>`
- Encapsula qual primitiva Meta chamar (texto/template/mídia/botões/lista).

### `EngineMessageRow`
- Campos da linha `messages` que **variam por tipo**: `content_type`,
  `content_text`, `template_name?`, `interactive_payload?`, `ai_generated?`.
- Campos **fixos pela base** (não vêm daqui): `sender_type='bot'`,
  `status='sent'`, `message_id` (wamid), `conversation_id`.

### `SendFromEngineArgs`
- `{ db, accountId, conversationId, contactId, resolveConfig, doMetaSend, buildMessageRow }`
- Retorno: `{ whatsapp_message_id: string }`

## Invariantes de validação (do comportamento atual)

- Contato deve existir **e** pertencer ao `account_id` — senão erro (defesa em
  profundidade sobre service-role).
- Telefone deve ser E.164 após `sanitizePhoneForMeta` — senão erro.
- Retry só continua para o próximo variante quando o erro é
  `isRecipientNotAllowedError`; qualquer outro erro é propagado.
- INSERT em `messages` que falha após a Meta aceitar → erro específico
  ("sent to Meta but DB insert failed"), nunca fingir que o envio falhou.
