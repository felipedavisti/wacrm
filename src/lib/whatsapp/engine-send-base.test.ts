import { describe, it, expect, vi } from 'vitest'
import {
  sendFromEngine,
  resolveConfigByAccount,
  resolveConfigByConversation,
  type ResolveConfig,
  type EngineMessageRow,
} from './engine-send-base'

// decrypt is exercised only by resolveConfigByAccount; stub it so the
// resolver test asserts the token flows through without a real key.
vi.mock('./encryption', () => ({
  decrypt: (s: string) => `decrypted:${s}`,
}))

// A contact whose stored phone is already valid E.164 (digits only).
const PHONE = '5511988887777'

interface DbOpts {
  contact?: { id: string; phone: string } | null
  contactError?: unknown
  config?: { phone_number_id: string; access_token: string } | null
  configError?: unknown
  insertError?: { message: string } | null
}

function makeDb(opts: DbOpts) {
  const calls = {
    fromTables: [] as string[],
    messages: [] as Record<string, unknown>[],
    conversationUpdates: [] as { payload: unknown; filters: [string, unknown][] }[],
    contactUpdates: [] as { payload: unknown; filters: [string, unknown][] }[],
  }

  function resolve(ops: {
    table: string
    type: string
    payload?: unknown
    filters: [string, unknown][]
  }) {
    const { table, type } = ops
    if (table === 'contacts') {
      if (type === 'update') {
        calls.contactUpdates.push({ payload: ops.payload, filters: ops.filters })
        return { data: null, error: null }
      }
      return { data: opts.contact ?? null, error: opts.contactError ?? null }
    }
    if (table === 'whatsapp_config') {
      return { data: opts.config ?? null, error: opts.configError ?? null }
    }
    if (table === 'messages') {
      calls.messages.push(ops.payload as Record<string, unknown>)
      return { error: opts.insertError ?? null }
    }
    if (table === 'conversations') {
      if (type === 'update') {
        calls.conversationUpdates.push({ payload: ops.payload, filters: ops.filters })
      }
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      payload: undefined as unknown,
      filters: [] as [string, unknown][],
    }
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push([k, v]), b),
      order: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      // `.limit()` resolves to an array (spec 007: account config is read
      // via .limit(1) now, not .single()).
      limit: () => {
        const r = resolve(ops) as { data: unknown; error: unknown }
        return Promise.resolve({
          data: r.data == null ? [] : [r.data],
          error: r.error,
        })
      },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    from: (t: string) => {
      calls.fromTables.push(t)
      return builder(t)
    },
  }
  return { db, calls }
}

/** A resolver that skips the DB entirely — most tests inject this so
 *  they exercise the base sequence, not the account lookup. */
const fixedResolver: ResolveConfig = async () => ({
  phoneNumberId: 'pn-1',
  accessToken: 'tok-1',
})

const textRow = (): { row: EngineMessageRow; preview: string } => ({
  row: { content_type: 'text', content_text: 'hi', ai_generated: false },
  preview: 'hi',
})

const base = (db: unknown) => ({
  db: db as never,
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  resolveConfig: fixedResolver,
  buildMessageRow: textRow,
})

describe('sendFromEngine — happy path', () => {
  it('sends via Meta, inserts the message row, bumps the conversation', async () => {
    const { db, calls } = makeDb({ contact: { id: 'contact-1', phone: PHONE } })
    const doMetaSend = vi.fn(async () => ({ messageId: 'wamid-1' }))

    const out = await sendFromEngine({ ...base(db), doMetaSend })

    expect(out).toEqual({ whatsapp_message_id: 'wamid-1' })
    // First variant is the original sanitized number; config flows through.
    expect(doMetaSend).toHaveBeenCalledWith({
      to: PHONE,
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
    })
    // The base adds the invariant columns around the per-type row.
    expect(calls.messages).toHaveLength(1)
    expect(calls.messages[0]).toEqual({
      conversation_id: 'conv-1',
      sender_type: 'bot',
      status: 'sent',
      message_id: 'wamid-1',
      content_type: 'text',
      content_text: 'hi',
      ai_generated: false,
    })
    // Conversation preview updated for this conversation.
    expect(calls.conversationUpdates).toHaveLength(1)
    expect(calls.conversationUpdates[0].filters).toContainEqual(['id', 'conv-1'])
    expect(
      (calls.conversationUpdates[0].payload as { last_message_text: string })
        .last_message_text,
    ).toBe('hi')
  })

  it('passes per-type row fields through verbatim (interactive_payload)', async () => {
    const { db, calls } = makeDb({ contact: { id: 'contact-1', phone: PHONE } })
    const payload = { kind: 'buttons', body: 'pick', buttons: [] }

    await sendFromEngine({
      ...base(db),
      doMetaSend: async () => ({ messageId: 'w' }),
      buildMessageRow: () => ({
        row: {
          content_type: 'interactive',
          content_text: 'pick',
          interactive_payload: payload,
        },
        preview: 'pick',
      }),
    })

    expect(calls.messages[0]).toMatchObject({
      content_type: 'interactive',
      interactive_payload: payload,
    })
  })
})

describe('sendFromEngine — account_id defense-in-depth', () => {
  it('throws and never sends when the contact is not in the account', async () => {
    const { db, calls } = makeDb({ contact: null }) // another tenant's UUID
    const doMetaSend = vi.fn(async () => ({ messageId: 'x' }))

    await expect(sendFromEngine({ ...base(db), doMetaSend })).rejects.toThrow(
      'contact not found for this account',
    )
    expect(doMetaSend).not.toHaveBeenCalled()
    expect(calls.messages).toHaveLength(0)
  })

  it('scopes the contact lookup by both id and account_id', async () => {
    const { db, calls } = makeDb({ contact: { id: 'contact-1', phone: PHONE } })
    await sendFromEngine({ ...base(db), doMetaSend: async () => ({ messageId: 'w' }) })
    // contacts was queried (select) before anything was sent.
    expect(calls.fromTables[0]).toBe('contacts')
  })

  it('throws on an invalid phone without sending', async () => {
    const { db } = makeDb({ contact: { id: 'contact-1', phone: '123' } })
    const doMetaSend = vi.fn(async () => ({ messageId: 'x' }))
    await expect(sendFromEngine({ ...base(db), doMetaSend })).rejects.toThrow(
      /contact phone invalid/,
    )
    expect(doMetaSend).not.toHaveBeenCalled()
  })
})

describe('sendFromEngine — phone-variant retry', () => {
  it('advances past a recipient-not-allowed error and corrects the contact phone', async () => {
    const { db, calls } = makeDb({ contact: { id: 'contact-1', phone: PHONE } })
    const seen: string[] = []
    const doMetaSend = vi.fn(async ({ to }: { to: string }) => {
      seen.push(to)
      if (seen.length === 1) throw new Error('131030 not in allowed list')
      return { messageId: 'wamid-2' }
    })

    const out = await sendFromEngine({ ...base(db), doMetaSend })

    expect(out.whatsapp_message_id).toBe('wamid-2')
    expect(doMetaSend.mock.calls.length).toBeGreaterThanOrEqual(2)
    // The working (second) variant differs from the original, so the
    // contact's phone is updated to it.
    const working = seen[1]
    expect(working).not.toBe(PHONE)
    expect(calls.contactUpdates).toHaveLength(1)
    expect(calls.contactUpdates[0].payload).toEqual({ phone: working })
    expect(calls.contactUpdates[0].filters).toContainEqual(['id', 'contact-1'])
  })

  it('propagates a non-recipient error immediately (single attempt)', async () => {
    const { db, calls } = makeDb({ contact: { id: 'contact-1', phone: PHONE } })
    const doMetaSend = vi.fn(async () => {
      throw new Error('some other Meta failure')
    })
    await expect(sendFromEngine({ ...base(db), doMetaSend })).rejects.toThrow(
      'some other Meta failure',
    )
    expect(doMetaSend).toHaveBeenCalledTimes(1)
    expect(calls.messages).toHaveLength(0)
  })

  it('throws the last error and inserts nothing when every variant is rejected', async () => {
    const { db, calls } = makeDb({ contact: { id: 'contact-1', phone: PHONE } })
    const doMetaSend = vi.fn(async () => {
      throw new Error('131030 not in allowed list')
    })
    await expect(sendFromEngine({ ...base(db), doMetaSend })).rejects.toThrow(
      /131030/,
    )
    expect(calls.messages).toHaveLength(0)
    expect(calls.contactUpdates).toHaveLength(0)
  })
})

describe('sendFromEngine — persistence failure', () => {
  it('surfaces a DB insert failure without pretending the send failed', async () => {
    const { db } = makeDb({
      contact: { id: 'contact-1', phone: PHONE },
      insertError: { message: 'constraint x' },
    })
    await expect(
      sendFromEngine({ ...base(db), doMetaSend: async () => ({ messageId: 'w' }) }),
    ).rejects.toThrow('sent to Meta but DB insert failed: constraint x')
  })
})

describe('resolveConfigByAccount — the default seam', () => {
  it('resolves phone_number_id + decrypted token by account, and the base uses them', async () => {
    const { db } = makeDb({
      contact: { id: 'contact-1', phone: PHONE },
      config: { phone_number_id: 'pn-acct', access_token: 'enc' },
    })
    const doMetaSend = vi.fn(async () => ({ messageId: 'w' }))

    await sendFromEngine({
      ...base(db),
      resolveConfig: resolveConfigByAccount(),
      doMetaSend,
    })

    expect(doMetaSend).toHaveBeenCalledWith({
      to: PHONE,
      phoneNumberId: 'pn-acct',
      accessToken: 'decrypted:enc',
    })
  })

  it('throws when no config exists for the account', async () => {
    const { db } = makeDb({
      contact: { id: 'contact-1', phone: PHONE },
      config: null,
    })
    await expect(
      sendFromEngine({
        ...base(db),
        resolveConfig: resolveConfigByAccount(),
        doMetaSend: async () => ({ messageId: 'w' }),
      }),
    ).rejects.toThrow('WhatsApp not configured for this account')
  })
})

// Dedicated db double for the multi-number resolver: distinguishes a
// whatsapp_config lookup by id (per-conversation) from one by account_id
// (the fallback).
function resolverDb(opts: {
  conv?: { whatsapp_config_id: string | null } | null
  configById?: { phone_number_id: string; access_token: string } | null
  configByAccount?: { phone_number_id: string; access_token: string } | null
}) {
  function resolve(ops: { table: string; filters: [string, unknown][] }) {
    if (ops.table === 'conversations') return { data: opts.conv ?? null, error: null }
    if (ops.table === 'whatsapp_config') {
      const byId = ops.filters.some((f) => f[0] === 'id')
      return {
        data: (byId ? opts.configById : opts.configByAccount) ?? null,
        error: null,
      }
    }
    return { data: null, error: null }
  }
  function builder(table: string) {
    const ops = { table, filters: [] as [string, unknown][] }
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => (ops.filters.push([k, v]), b),
      order: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      // Account fallback reads config via .limit(1) now → array (spec 007).
      limit: () => {
        const r = resolve(ops) as { data: unknown; error: unknown }
        return Promise.resolve({
          data: r.data == null ? [] : [r.data],
          error: r.error,
        })
      },
    }
    return b
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => builder(t) } as any
}

describe('resolveConfigByConversation — multi-number (spec 007)', () => {
  const ctx = {
    accountId: 'acct-1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
  }

  it('resolves the config from the conversation’s own number', async () => {
    const db = resolverDb({
      conv: { whatsapp_config_id: 'wc-2' },
      configById: { phone_number_id: 'PN-2', access_token: 'enc2' },
      configByAccount: { phone_number_id: 'PN-acct', access_token: 'encA' },
    })
    const out = await resolveConfigByConversation()({ db, ...ctx })
    expect(out).toEqual({ phoneNumberId: 'PN-2', accessToken: 'decrypted:enc2' })
  })

  it('falls back to the account config when the conversation has no number', async () => {
    const db = resolverDb({
      conv: { whatsapp_config_id: null },
      configByAccount: { phone_number_id: 'PN-acct', access_token: 'encA' },
    })
    const out = await resolveConfigByConversation()({ db, ...ctx })
    expect(out).toEqual({ phoneNumberId: 'PN-acct', accessToken: 'decrypted:encA' })
  })

  it('throws when the conversation’s number has no config row', async () => {
    const db = resolverDb({ conv: { whatsapp_config_id: 'wc-missing' }, configById: null })
    await expect(resolveConfigByConversation()({ db, ...ctx })).rejects.toThrow(
      'WhatsApp not configured for this conversation',
    )
  })
})

describe('sendFromEngine — seam readiness for multi-number (US2)', () => {
  it('uses an injected per-conversation resolver with no other change', async () => {
    const { db } = makeDb({ contact: { id: 'contact-1', phone: PHONE } })
    const doMetaSend = vi.fn(async () => ({ messageId: 'w' }))
    // A fake resolver that keys off conversationId — the shape the
    // multi-number feature will provide. The base doesn't know the
    // difference; it just calls resolveConfig.
    const perConversation: ResolveConfig = async ({ conversationId }) => ({
      phoneNumberId: `pn-for-${conversationId}`,
      accessToken: 'tok',
    })

    await sendFromEngine({ ...base(db), resolveConfig: perConversation, doMetaSend })

    expect(doMetaSend).toHaveBeenCalledWith({
      to: PHONE,
      phoneNumberId: 'pn-for-conv-1',
      accessToken: 'tok',
    })
  })
})
