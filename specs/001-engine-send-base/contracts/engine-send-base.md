# Contrato: `sendFromEngine` (engine-send-base)

Módulo: `src/lib/whatsapp/engine-send-base.ts`

Este é o contrato interno que os dois motores (`automations`, `flows`) passam a
usar. Não é uma API externa — é o ponto único de envio dos motores. A forma
abaixo é a referência para a implementação e os testes.

## Costura de resolução de config (o ponto que a multi-número vai mudar)

```ts
/** Config resolvida e pronta para enviar (token já descriptografado). */
export interface ResolvedSendConfig {
  phoneNumberId: string
  accessToken: string
  // Futuro multi-número: whatsappConfigId?: string
}

/**
 * COSTURA. Hoje: resolve por account_id (.single()). Futuro multi-número:
 * uma implementação que resolve por conversationId. A base NÃO sabe qual é —
 * só chama. Trocar o resolver é a única mudança que a multi-número precisa
 * fazer aqui.
 */
export type ResolveConfig = (ctx: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
}) => Promise<ResolvedSendConfig>

/** Resolver padrão de hoje: 1 número por conta. */
export function resolveConfigByAccount(): ResolveConfig
```

## Parametrização por tipo de mensagem

```ts
/** A chamada específica da Meta API para este envio. Recebe o telefone
 *  (variante em teste) + a config resolvida; devolve o wamid da Meta. */
export type DoMetaSend = (args: {
  to: string
  phoneNumberId: string
  accessToken: string
}) => Promise<{ messageId: string }>

/** Campos da linha `messages` específicos deste tipo. A base adiciona
 *  sender_type='bot', status='sent', message_id (wamid) e conversation_id. */
export interface EngineMessageRow {
  content_type: 'text' | 'template' | 'image' | 'video' | 'document' | 'interactive'
  content_text: string | null
  template_name?: string | null
  interactive_payload?: unknown | null
  ai_generated?: boolean
}
```

## Função principal

```ts
export interface SendFromEngineArgs {
  db: SupabaseClient           // client service-role (admin)
  accountId: string
  conversationId: string
  contactId: string
  resolveConfig: ResolveConfig
  doMetaSend: DoMetaSend
  /** Campos por tipo + o texto de preview da conversa. */
  buildMessageRow: () => { row: EngineMessageRow; preview: string }
}

export async function sendFromEngine(
  args: SendFromEngineArgs,
): Promise<{ whatsapp_message_id: string }>
```

## Comportamento (invariante — idêntico ao atual)

A base executa, nesta ordem:

1. Carregar contato por `(id = contactId, account_id = accountId)`; erro se não
   achar ou sem telefone. **(filtro account_id — Princípio II)**
2. `sanitizePhoneForMeta` + `isValidE164`; erro se inválido.
3. `resolveConfig(...)` → `{ phoneNumberId, accessToken }`. **(a costura)**
4. Retry por `phoneVariants(sanitized)`: para cada variante, chamar
   `doMetaSend`; parar na primeira que envia; se o erro for
   `isRecipientNotAllowedError`, tentar a próxima; senão, propagar.
5. Se a variante que funcionou difere da original, `update` do telefone no
   contato.
6. `insert` em `messages`: `{ ...row, sender_type: 'bot', status: 'sent',
   message_id: wamid, conversation_id }`. Se o insert falhar, lançar erro
   "sent to Meta but DB insert failed" (a Meta já recebeu — não fingir falha).
7. `update` da conversa: `last_message_text = preview`, `last_message_at` e
   `updated_at = now()`.
8. Retornar `{ whatsapp_message_id: wamid }`.

## Adaptadores (o que cada motor passa)

| Envio | `doMetaSend` chama | `buildMessageRow.row` | `preview` |
|---|---|---|---|
| texto | `sendTextMessage` | `content_type:'text'`, `content_text:text`, `ai_generated` | `text` |
| template | `sendTemplateMessage` | `content_type:'template'`, `template_name` | `[template:name]` |
| mídia | `sendMediaMessage` | `content_type:kind`, `content_text:caption` | `caption \|\| [kind]` |
| botões | `sendInteractiveButtons` | `content_type:'interactive'`, `content_text:body`, `interactive_payload` | `body` |
| lista | `sendInteractiveList` | `content_type:'interactive'`, `content_text:body`, `interactive_payload` | `body` |

Os `meta-send.ts` de cada motor mantêm suas **assinaturas públicas atuais**
(`engineSendText`, `engineSendTemplate`, `engineSendMedia`,
`engineSendInteractiveButtons/List`, `engineSendInteractive`) para não tocar em
`engine.ts` — internamente cada um monta os 3 parâmetros e chama `sendFromEngine`.
