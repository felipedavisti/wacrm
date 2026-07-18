import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sendTextMessage,
  sendTemplateMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/lib/whatsapp/meta-api'

// Characterization of the automation-side adapters: prove each public
// function maps to the right Meta primitive + messages row + preview
// through the shared base. See specs/001-engine-send-base (T003).

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
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid' })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `dec:${s}` }))

import { engineSendText, engineSendTemplate, engineSendInteractive } from './meta-send'

const ids = { accountId: 'a1', userId: 'u1', conversationId: 'conv1', contactId: 'c1' }

beforeEach(() => {
  h.state.contact = { id: 'c1', phone: PHONE }
  h.state.config = { phone_number_id: 'PN', access_token: 'enc' }
  h.state.messages = []
  h.state.conversationUpdates = []
})

describe('automations engineSendText', () => {
  it('sends text with the resolved (decrypted) config and persists a text row', async () => {
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
      template_name: null,
    })
    expect(h.state.conversationUpdates[0]).toMatchObject({ last_message_text: 'hi' })
  })
})

describe('automations engineSendTemplate', () => {
  it('sends the template and persists a template row + [template:] preview', async () => {
    await engineSendTemplate({ ...ids, templateName: 'welcome', params: ['X'] })

    expect(sendTemplateMessage).toHaveBeenCalledWith({
      phoneNumberId: 'PN',
      accessToken: 'dec:enc',
      to: PHONE,
      templateName: 'welcome',
      language: undefined,
      params: ['X'],
    })
    expect(h.state.messages[0]).toEqual({
      conversation_id: 'conv1',
      sender_type: 'bot',
      status: 'sent',
      message_id: 'wamid',
      content_type: 'template',
      content_text: null,
      template_name: 'welcome',
    })
    expect(h.state.conversationUpdates[0]).toMatchObject({
      last_message_text: '[template:welcome]',
    })
  })
})

describe('automations engineSendInteractive', () => {
  it('sends buttons and persists a reconstructed interactive_payload', async () => {
    await engineSendInteractive({
      ...ids,
      payload: {
        kind: 'buttons',
        body: 'pick',
        header: 'H',
        footer: 'F',
        buttons: [{ id: 'b1', title: 'One' }],
      },
    })

    expect(sendInteractiveButtons).toHaveBeenCalledWith({
      phoneNumberId: 'PN',
      accessToken: 'dec:enc',
      to: PHONE,
      bodyText: 'pick',
      buttons: [{ id: 'b1', title: 'One' }],
      headerText: 'H',
      footerText: 'F',
    })
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

  it('strips unknown keys off the payload before persisting (finding-1 guard)', async () => {
    await engineSendInteractive({
      ...ids,
      payload: {
        kind: 'buttons',
        body: 'pick',
        buttons: [],
        // A stray runtime key that must NOT reach the JSONB column.
        legacyId: 'should-be-dropped',
      } as never,
    })

    const stored = h.state.messages[0].interactive_payload as Record<string, unknown>
    expect(stored).not.toHaveProperty('legacyId')
    expect(Object.keys(stored).sort()).toEqual(['body', 'buttons', 'footer', 'header', 'kind'])
  })

  it('routes a list payload to sendInteractiveList', async () => {
    await engineSendInteractive({
      ...ids,
      payload: {
        kind: 'list',
        body: 'menu',
        button_label: 'Open',
        sections: [{ title: 'S', rows: [{ id: 'r1', title: 'Row' }] }],
      },
    })

    expect(sendInteractiveList).toHaveBeenCalledOnce()
    expect(sendInteractiveButtons).not.toHaveBeenCalled()
    expect(h.state.messages[0]).toMatchObject({ content_type: 'interactive', content_text: 'menu' })
  })
})
