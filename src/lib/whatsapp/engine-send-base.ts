import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'

// ------------------------------------------------------------
// Shared send base for the two engines (automations + flows).
//
// Both engines used to carry an identical copy of the send
// sequence: load contact (scoped by account_id) → E.164 → resolve
// the WhatsApp config → phone-variant retry → persist the message →
// bump the conversation. This module is that sequence, once.
//
// Two things are parameterized so the base stays behaviour-identical
// for every message type:
//   - `resolveConfig` — THE seam. Today it resolves the WhatsApp
//     config by account_id (`resolveConfigByAccount`). The
//     multi-number feature swaps only this for a per-conversation
//     resolver; the base never learns which one it got (spec 001 →
//     spec 007).
//   - `doMetaSend` + `buildMessageRow` — the per-type Meta call and
//     the per-type `messages` row + conversation preview.
//
// The account_id filter on the contact lookup lives INSIDE the base:
// the engines use the service-role client (RLS-bypassing), so this
// is the defense-in-depth that keeps one tenant from sending to
// another tenant's contact UUID (Constitution, Principle II).
// ------------------------------------------------------------

/** Config resolved and ready to send with (token already decrypted). */
export interface ResolvedSendConfig {
  phoneNumberId: string
  accessToken: string
  // Future multi-number: whatsappConfigId?: string
}

/**
 * THE SEAM. Today: resolves by account_id (`.single()`). Future
 * multi-number: an implementation that resolves by conversationId.
 * The base does NOT know which — it only calls. Swapping the resolver
 * is the single change multi-number needs to make here.
 */
export type ResolveConfig = (ctx: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
}) => Promise<ResolvedSendConfig>

/**
 * Today's default resolver: one WhatsApp number per account. This is
 * the ONLY place with the `whatsapp_config` `.single()` — the
 * multi-number seam changes exactly this and nothing else.
 */
export function resolveConfigByAccount(): ResolveConfig {
  return async ({ db, accountId }) => {
    // Account's first number. `.single()` threw PGRST116 once an account
    // had ≥2 numbers — but this is only the FALLBACK (the conversation had
    // no number stamped); the by-conversation resolver above is the normal
    // path. Fall back to the first number rather than crash.
    const { data: configRows, error } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
    const config = configRows?.[0]
    if (error || !config) {
      throw new Error('WhatsApp not configured for this account')
    }
    return {
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
    }
  }
}

/**
 * Multi-number resolver (spec 007): resolves the config from the CONVERSATION's
 * own number (`conversations.whatsapp_config_id`, migration 503), so the reply
 * goes out through the number the thread belongs to — never "the account's
 * number" (there may be several). This is the swap the 001 seam was built for.
 *
 * Falls back to `resolveConfigByAccount` when the conversation has no number
 * assigned yet (a row created before migration 503 backfilled it, or an
 * account still on a single number) — a safe transition either side of the
 * migration.
 */
export function resolveConfigByConversation(): ResolveConfig {
  const byAccount = resolveConfigByAccount()
  return async (ctx) => {
    const { db, conversationId } = ctx
    const { data: conv } = await db
      .from('conversations')
      .select('whatsapp_config_id')
      .eq('id', conversationId)
      .maybeSingle()

    if (!conv?.whatsapp_config_id) {
      // Legacy / pre-migration conversation — resolve by account (single number).
      return byAccount(ctx)
    }

    const { data: config, error } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('id', conv.whatsapp_config_id)
      .single()
    if (error || !config) {
      throw new Error('WhatsApp not configured for this conversation')
    }
    return {
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
    }
  }
}

/** The specific Meta API call for this send. Gets the phone (the
 *  variant under test) + the resolved config; returns Meta's wamid. */
export type DoMetaSend = (args: {
  to: string
  phoneNumberId: string
  accessToken: string
}) => Promise<{ messageId: string }>

/** The `messages`-row fields specific to this send type. The base
 *  adds sender_type='bot', status='sent', message_id (wamid) and
 *  conversation_id. 'audio' is included because MediaKind carries it. */
export interface EngineMessageRow {
  content_type:
    | 'text'
    | 'template'
    | 'image'
    | 'video'
    | 'document'
    | 'audio'
    | 'interactive'
  content_text: string | null
  template_name?: string | null
  interactive_payload?: unknown | null
  ai_generated?: boolean
}

export interface SendFromEngineArgs {
  /** Service-role (admin) client — the engines have no user session. */
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  resolveConfig: ResolveConfig
  doMetaSend: DoMetaSend
  /** Per-type row fields + the conversation preview text. */
  buildMessageRow: () => { row: EngineMessageRow; preview: string }
}

/**
 * The single send sequence both engines use. Behaviour is identical
 * to the copies it replaces — see specs/001-engine-send-base.
 */
export async function sendFromEngine(
  args: SendFromEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { db, accountId, conversationId, contactId } = args

  // 1. Contact, scoped by account_id (defense-in-depth over service-role).
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  // 2. Normalize to E.164.
  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  // 3. Resolve the config — the seam.
  const { phoneNumberId, accessToken } = await args.resolveConfig({
    db,
    accountId,
    conversationId,
    contactId,
  })

  // 4. Phone-variant retry: first variant that lands wins; keep going
  //    only on a "recipient not allowed" error, propagate anything else.
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      const r = await args.doMetaSend({ to: v, phoneNumberId, accessToken })
      waMessageId = r.messageId
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  // 5. If a corrected variant worked, persist it back on the contact.
  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  // 6. Persist the sent message. Meta already has it — a DB failure here
  //    is surfaced as an error, never swallowed into a fake success.
  const { row, preview } = args.buildMessageRow()
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    status: 'sent',
    message_id: waMessageId,
    ...row,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  // 7. Bump the conversation preview.
  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  return { whatsapp_message_id: waMessageId }
}
