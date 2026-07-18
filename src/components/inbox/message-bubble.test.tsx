import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '@/types'

// next-intl's useTranslations needs a provider; stub it so the bubble
// renders standalone. Only the keys this test exercises need real values.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) => {
    if (key === 'unknownAuthor') return 'Unknown agent'
    if (key === 'sentByTitle') return `Sent by ${vals?.name}`
    return key
  },
}))

import { MessageBubble } from './message-bubble'

// Outbound attribution rendering (spec 003, US2). The `Sent by` tooltip is
// only emitted for attributed messages, so it's a clean discriminator for
// "author shown vs not" without depending on DOM layout.
function render(message: Partial<Message>, senderName?: string | null) {
  return renderToStaticMarkup(
    React.createElement(MessageBubble, {
      message: {
        id: 'm1',
        conversation_id: 'c1',
        content_type: 'text',
        content_text: 'hello',
        status: 'sent',
        created_at: '2026-01-01T12:00:00Z',
        ...message,
      } as Message,
      senderName,
    }),
  )
}

describe('MessageBubble — outbound attribution (spec 003)', () => {
  it('shows the resolved agent name for an attributed agent message', () => {
    const html = render({ sender_type: 'agent', sender_id: 'u1' }, 'Felipe Davis')
    expect(html).toContain('Felipe Davis')
    expect(html).toContain('Sent by Felipe Davis')
  })

  it('falls back to "Unknown agent" when the sender_id does not resolve', () => {
    const html = render({ sender_type: 'agent', sender_id: 'ghost' }, null)
    expect(html).toContain('Unknown agent')
  })

  it('shows no author for a bot message', () => {
    const html = render({ sender_type: 'bot', sender_id: null as unknown as undefined })
    expect(html).not.toContain('Sent by')
    expect(html).not.toContain('Unknown agent')
  })

  it('shows no author for a customer (inbound) message', () => {
    const html = render({ sender_type: 'customer' })
    expect(html).not.toContain('Sent by')
  })

  it('shows no author for a legacy agent message with no sender_id', () => {
    const html = render({ sender_type: 'agent', sender_id: undefined })
    expect(html).not.toContain('Sent by')
    expect(html).not.toContain('Unknown agent')
  })
})
