import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  sendFromEngine,
  resolveConfigByConversation,
} from '@/lib/whatsapp/engine-send-base'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Flows-side Meta sender — thin adapters over the shared send base
// (src/lib/whatsapp/engine-send-base.ts).
//
// The public signatures below are unchanged so the Flows engine
// (engine.ts) is untouched. Each function only builds the three
// per-type parameters — the Meta call, the messages row, the preview
// — and delegates the whole send sequence (contact lookup scoped by
// account_id, phone-variant retry, persistence, conversation bump) to
// `sendFromEngine`. See specs/001-engine-send-base.
// ------------------------------------------------------------

interface SendTextEngineArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so a flow authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the flow. Not consulted for tenancy, and
   *  ignored by the send base — kept for signature stability. */
  userId: string
  conversationId: string
  contactId: string
  text: string
  /** Marks the persisted message row `ai_generated = true` so the inbox
   *  badges it as an AI reply. Only the auto-reply bot sets this;
   *  deterministic Flow/automation sends leave it false. */
  aiGenerated?: boolean
}

/**
 * Send a plain-text WhatsApp message from the Flows engine.
 *
 * Used by the runner's `send_message` and `collect_input` nodes —
 * both prompt the customer with text and either auto-advance (the
 * send_message case) or suspend awaiting a text reply (collect_input).
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendFromEngine({
    db: supabaseAdmin(),
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    resolveConfig: resolveConfigByConversation(),
    doMetaSend: ({ to, phoneNumberId, accessToken }) =>
      sendTextMessage({ phoneNumberId, accessToken, to, text: args.text }),
    buildMessageRow: () => ({
      row: {
        content_type: 'text',
        content_text: args.text,
        ai_generated: args.aiGenerated ?? false,
      },
      preview: args.text,
    }),
  })
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  caption?: string
  /** Document-only; ignored by Meta for image/video. */
  filename?: string
}

/**
 * Send an image / video / document from the Flows engine.
 *
 * Used by the runner's `send_media` node. Persists the outgoing
 * message with `content_type` matching the media kind so the inbox
 * renders the right preview.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendFromEngine({
    db: supabaseAdmin(),
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    resolveConfig: resolveConfigByConversation(),
    doMetaSend: ({ to, phoneNumberId, accessToken }) =>
      sendMediaMessage({
        phoneNumberId,
        accessToken,
        to,
        kind: args.kind,
        link: args.link,
        caption: args.caption,
        filename: args.filename,
      }),
    buildMessageRow: () => ({
      // content_type='image'|'video'|'document' is already in the
      // messages_content_type_check constraint (migration 001 + 010).
      // content_text carries the caption (or null).
      row: { content_type: args.kind, content_text: args.caption ?? null },
      preview: args.caption?.trim() || `[${args.kind}]`,
    }),
  })
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 *
 * Persists the outgoing message to `messages` with
 * `content_type='interactive'` and `sender_type='bot'` so the inbox
 * surfaces it with the "Button reply" affordance and the conversation
 * thread reflects the bot's prompt.
 *
 * Returns the Meta message id so the caller (engine) can stash it on
 * the `flow_runs.last_prompt_message_id` field for later reference.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 * Used when the flow needs more than 3 options (Meta's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  // We do NOT set interactive_reply_id here — that column is reserved
  // for the customer's tap on this message, populated by the webhook
  // when their reply arrives. We DO persist the structured payload so
  // the inbox thread re-renders the buttons/rows the bot sent.
  const interactivePayload: InteractiveMessagePayload =
    input.kind === 'buttons'
      ? {
          kind: 'buttons',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          buttons: input.buttons,
        }
      : {
          kind: 'list',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          button_label: input.buttonLabel,
          sections: input.sections,
        }

  return sendFromEngine({
    db: supabaseAdmin(),
    accountId: input.accountId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    resolveConfig: resolveConfigByConversation(),
    doMetaSend: ({ to, phoneNumberId, accessToken }) => {
      if (input.kind === 'buttons') {
        return sendInteractiveButtons({
          phoneNumberId,
          accessToken,
          to,
          bodyText: input.bodyText,
          buttons: input.buttons,
          headerText: input.headerText,
          footerText: input.footerText,
        })
      }
      return sendInteractiveList({
        phoneNumberId,
        accessToken,
        to,
        bodyText: input.bodyText,
        buttonLabel: input.buttonLabel,
        sections: input.sections,
        headerText: input.headerText,
        footerText: input.footerText,
      })
    },
    buildMessageRow: () => ({
      row: {
        content_type: 'interactive',
        content_text: input.bodyText,
        interactive_payload: interactivePayload,
      },
      preview: input.bodyText,
    }),
  })
}
