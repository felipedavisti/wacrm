import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sendTextMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/lib/whatsapp/meta-api'

// Characterization of the flows-side adapters: prove each public
// function maps to the right Meta primitive + messages row + preview
// through the shared base. See specs/001-engine-send-base (T002).

const PHONE = '5511988887777'

const h = vi.hoisted(() => ({
  state: {
    contact: { id: 'c1', phone: '5511988887777' } as { id: string; phone: string } | null,
    config: { phone_number_id: 'PN', access_token: 'enc' } as
      | { phone_number_id: string; access_token: string }
      | null,
    messages: [] as Record<string, unknown>[],
    conversationUpdates: [] as Record<string, unknown>[],
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h
  function resolve(ops: { table: string; type: string; payload?: unknown }) {
    const { table, type } = ops
    if (table === 'contacts') {
      if (type === 'update') return { data: null, error: null }
      return { data: state.contact, error: null }
    }
    if (table === 'whatsapp_config') return { data: state.config, error: null }
    if (table === 'messages') {
      state.messages.push(ops.payload as Record<string, unknown>)
      return { error: null }
    }
    if (table === 'conversations') {
      if (type === 'update') state.conversationUpdates.push(ops.payload as Record<string, unknown>)
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }
  function builder(table: string) {
    const ops = { table, type: 'select', payload: undefined as unknown }
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      eq: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }
  return { supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }
})

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid' })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `dec:${s}` }))

import {
  engineSendText,
  engineSendMedia,
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from './meta-send'

const ids = { accountId: 'a1', userId: 'u1', conversationId: 'conv1', contactId: 'c1' }

beforeEach(() => {
  h.state.contact = { id: 'c1', phone: PHONE }
  h.state.config = { phone_number_id: 'PN', access_token: 'enc' }
  h.state.messages = []
  h.state.conversationUpdates = []
})

describe('flows engineSendText', () => {
  it('persists a text row with ai_generated defaulting to false', async () => {
    await engineSendText({ ...ids, text: 'hi' })

    expect(sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: 'PN',
      accessToken: 'dec:enc',
      to: PHONE,
      text: 'hi',
    })
    expect(h.state.messages[0]).toEqual({
      conversation_id: 'conv1',
      sender_type: 'bot',
      status: 'sent',
      message_id: 'wamid',
      content_type: 'text',
      content_text: 'hi',
      ai_generated: false,
    })
  })

  it('marks ai_generated=true when the caller sets it (AI auto-reply path)', async () => {
    await engineSendText({ ...ids, text: 'hi', aiGenerated: true })
    expect(h.state.messages[0]).toMatchObject({ ai_generated: true })
  })
})

describe('flows engineSendMedia', () => {
  it('persists content_type = media kind and uses the caption as preview', async () => {
    await engineSendMedia({ ...ids, kind: 'image', link: 'https://x/i.png', caption: 'look' })

    expect(sendMediaMessage).toHaveBeenCalledWith({
      phoneNumberId: 'PN',
      accessToken: 'dec:enc',
      to: PHONE,
      kind: 'image',
      link: 'https://x/i.png',
      caption: 'look',
      filename: undefined,
    })
    expect(h.state.messages[0]).toEqual({
      conversation_id: 'conv1',
      sender_type: 'bot',
      status: 'sent',
      message_id: 'wamid',
      content_type: 'image',
      content_text: 'look',
    })
    expect(h.state.conversationUpdates[0]).toMatchObject({ last_message_text: 'look' })
  })

  it('falls back to a [kind] preview when there is no caption', async () => {
    await engineSendMedia({ ...ids, kind: 'document', link: 'https://x/d.pdf' })
    expect(h.state.messages[0]).toMatchObject({ content_type: 'document', content_text: null })
    expect(h.state.conversationUpdates[0]).toMatchObject({ last_message_text: '[document]' })
  })
})

describe('flows interactive senders', () => {
  it('buttons: sends via primitive and persists the structured payload', async () => {
    await engineSendInteractiveButtons({
      ...ids,
      bodyText: 'pick',
      buttons: [{ id: 'b1', title: 'One' }],
      headerText: 'H',
      footerText: 'F',
    })

    expect(sendInteractiveButtons).toHaveBeenCalledOnce()
    expect(h.state.messages[0]).toMatchObject({
      content_type: 'interactive',
      content_text: 'pick',
      interactive_payload: {
        kind: 'buttons',
        body: 'pick',
        header: 'H',
        footer: 'F',
        buttons: [{ id: 'b1', title: 'One' }],
      },
    })
  })

  it('list: routes to the list primitive', async () => {
    await engineSendInteractiveList({
      ...ids,
      bodyText: 'menu',
      buttonLabel: 'Open',
      sections: [{ title: 'S', rows: [{ id: 'r1', title: 'Row' }] }],
    })

    expect(sendInteractiveList).toHaveBeenCalledOnce()
    expect(sendInteractiveButtons).not.toHaveBeenCalled()
    expect(h.state.messages[0]).toMatchObject({
      content_type: 'interactive',
      interactive_payload: { kind: 'list', body: 'menu', button_label: 'Open' },
    })
  })
})
