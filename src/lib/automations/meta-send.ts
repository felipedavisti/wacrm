import {
  sendTextMessage,
  sendTemplateMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  sendFromEngine,
  resolveConfigByAccount,
} from '@/lib/whatsapp/engine-send-base'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side Meta sender — thin adapters over the shared send
// base (src/lib/whatsapp/engine-send-base.ts).
//
// The public signatures are unchanged so the automation engine
// (engine.ts) is untouched. Interactive sends now build straight off
// the Meta primitives through the base — the old dependency on
// `@/lib/flows/meta-send` is gone, so the two engines no longer couple.
// See specs/001-engine-send-base.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the automation/flow. Not consulted for
   *  tenancy, and ignored by the send base — kept for signature
   *  stability. */
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(
  args: SendTextArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendFromEngine({
    db: supabaseAdmin(),
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    resolveConfig: resolveConfigByAccount(),
    doMetaSend: ({ to, phoneNumberId, accessToken }) =>
      sendTextMessage({ phoneNumberId, accessToken, to, text: args.text }),
    buildMessageRow: () => ({
      row: { content_type: 'text', content_text: args.text, template_name: null },
      preview: args.text,
    }),
  })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendFromEngine({
    db: supabaseAdmin(),
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    resolveConfig: resolveConfigByAccount(),
    doMetaSend: ({ to, phoneNumberId, accessToken }) =>
      sendTemplateMessage({
        phoneNumberId,
        accessToken,
        to,
        templateName: args.templateName,
        language: args.language,
        params: args.params,
      }),
    buildMessageRow: () => ({
      row: {
        content_type: 'template',
        content_text: null,
        template_name: args.templateName,
      },
      preview: `[template:${args.templateName}]`,
    }),
  })
}

interface SendInteractiveArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  payload: InteractiveMessagePayload
}

/**
 * Send an interactive (reply-buttons or list) message from the
 * automation engine.
 *
 * Builds the Meta call off the primitives and persists the row with
 * `content_type='interactive'`, `interactive_payload` and
 * `sender_type='bot'` — identical to the Flows interactive send, now
 * via the shared base rather than by calling into flows/meta-send.
 */
export async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { payload } = args
  return sendFromEngine({
    db: supabaseAdmin(),
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    resolveConfig: resolveConfigByAccount(),
    doMetaSend: ({ to, phoneNumberId, accessToken }) => {
      if (payload.kind === 'buttons') {
        return sendInteractiveButtons({
          phoneNumberId,
          accessToken,
          to,
          bodyText: payload.body,
          buttons: payload.buttons,
          headerText: payload.header,
          footerText: payload.footer,
        })
      }
      return sendInteractiveList({
        phoneNumberId,
        accessToken,
        to,
        bodyText: payload.body,
        buttonLabel: payload.button_label,
        sections: payload.sections,
        headerText: payload.header,
        footerText: payload.footer,
      })
    },
    buildMessageRow: () => ({
      row: {
        content_type: 'interactive',
        content_text: payload.body,
        interactive_payload: payload,
      },
      preview: payload.body,
    }),
  })
}
