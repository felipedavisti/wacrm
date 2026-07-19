import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api';

// Module mocks for the happy-path attribution tests below. The pre-DB
// validation tests short-circuit before any of these are reached, so the
// mocks are inert for them.
vi.mock('@/lib/whatsapp/meta-api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/whatsapp/meta-api')>();
  return {
    ...actual, // keep INTERACTIVE_LIMITS etc. that interactive.ts imports
    sendTextMessage: vi.fn(async () => ({ messageId: 'wamid' })),
    sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid' })),
    sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid' })),
    sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid' })),
    sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid' })),
  };
});
vi.mock('@/lib/whatsapp/encryption', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/whatsapp/encryption')>();
  return { ...actual, decrypt: () => 'tok', isLegacyFormat: () => false };
});
vi.mock('@/lib/flows/admin-client', () => {
  // flow_runs pause: update().eq().eq().eq() → thenable resolving { error }
  const chain: Record<string, unknown> = {
    update: () => chain,
    eq: () => chain,
    then: (f: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(f),
  };
  return { supabaseAdmin: () => ({ from: () => chain }) };
});

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

// A minimal happy-path Supabase double: enough tables wired for a text
// send to reach (and capture) the messages insert. Captures the insert
// payload so we can assert sender_id (spec 003).
function happyDb(
  capture: { messageInsert?: Record<string, unknown> },
  opts: { lastInboundAt?: string | null } = {},
): SupabaseClient {
  // Default to an OPEN 24h window (recent inbound) so text sends flow
  // through; window tests pass an explicit value to close it.
  const lastInboundAt =
    opts.lastInboundAt === undefined
      ? new Date().toISOString()
      : opts.lastInboundAt;
  function resolve(ops: { table: string; type: string; payload?: unknown }) {
    const { table, type } = ops;
    if (table === 'conversations') {
      if (type === 'update') return { error: null };
      return {
        data: {
          id: 'cv-1',
          last_inbound_at: lastInboundAt,
          contact: { id: 'ct-1', phone: '5511988887777' },
        },
        error: null,
      };
    }
    if (table === 'whatsapp_config') {
      // Now loaded via .limit(1) (spec 007) → data is an array, not a row.
      return {
        data: [{ id: 'wc-1', phone_number_id: 'PN', access_token: 'enc' }],
        error: null,
      };
    }
    if (table === 'messages') {
      if (type === 'insert') {
        capture.messageInsert = ops.payload as Record<string, unknown>;
        return { data: { id: 'msg-1' }, error: null };
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
  function builder(table: string) {
    const ops = { table, type: 'select', payload: undefined as unknown };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      eq: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(f, r),
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient;
}

describe('sendMessageToConversation — outbound attribution (sender_id)', () => {
  const textParams: SendMessageParams = {
    conversationId: 'cv-1',
    messageType: 'text',
    contentText: 'hello',
  };

  it('persists sender_id when a human agent authored the send', async () => {
    const capture: { messageInsert?: Record<string, unknown> } = {};
    await sendMessageToConversation(happyDb(capture), 'acct-1', {
      ...textParams,
      senderId: 'agent-A',
    });
    expect(capture.messageInsert).toMatchObject({
      sender_type: 'agent',
      sender_id: 'agent-A',
    });
  });

  it('leaves sender_id null when no agent is provided (bot / public API)', async () => {
    const capture: { messageInsert?: Record<string, unknown> } = {};
    await sendMessageToConversation(happyDb(capture), 'acct-1', textParams);
    expect(capture.messageInsert).toMatchObject({
      sender_type: 'agent',
      sender_id: null,
    });
  });
});

describe('sendMessageToConversation — 24h window (spec 005)', () => {
  const OVER_24H = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  it('refuses free-form text outside the window BEFORE calling Meta', async () => {
    const err = await sendMessageToConversation(
      happyDb({}, { lastInboundAt: OVER_24H }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'hi' },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SendMessageError);
    expect(err.code).toBe('window_expired');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('refuses free-form outside the window when there was never an inbound (null)', async () => {
    const err = await sendMessageToConversation(
      happyDb({}, { lastInboundAt: null }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'hi' },
    ).catch((e) => e);
    expect(err.code).toBe('window_expired');
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('always allows a template outside the window (it reopens the conversation)', async () => {
    const capture: { messageInsert?: Record<string, unknown> } = {};
    await sendMessageToConversation(
      happyDb(capture, { lastInboundAt: OVER_24H }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'template', templateName: 'welcome' },
    );
    expect(sendTemplateMessage).toHaveBeenCalled();
    expect(capture.messageInsert).toMatchObject({ content_type: 'template' });
  });

  it('maps a Meta 131047 rejection to window_expired (race backstop)', async () => {
    vi.mocked(sendTextMessage).mockRejectedValueOnce(
      new Error('(#131047) Message failed to send: re-engagement message'),
    );
    // Window is open locally (default), so the check passes and we reach
    // Meta — which rejects with 131047; the core remaps it.
    const err = await sendMessageToConversation(happyDb({}), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'hi',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SendMessageError);
    expect(err.code).toBe('window_expired');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});
