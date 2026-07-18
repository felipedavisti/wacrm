import { describe, it, expect } from 'vitest'
import { mirrorMessageStatus } from './status-mirror'

// Isolation proof for the webhook status mirror (spec 006, T005): a Meta
// status event for a number owned by account A must never flip the status
// of account B's message that happens to carry the same (non-unique)
// message_id.

interface Fixture {
  config: { account_id: string } | null
  messages: { id: string; conversation_id: string }[]
  conversations: { id: string; account_id: string }[]
}

function makeDb(fx: Fixture) {
  const updated = { ids: null as string[] | null, status: null as string | null }

  function resolve(ops: {
    table: string
    type: string
    payload?: unknown
    filters: [string, unknown][]
    inFilter?: { col: string; values: unknown[] }
  }) {
    const { table, type } = ops
    if (table === 'whatsapp_config') return { data: fx.config, error: null }
    if (table === 'messages') {
      if (type === 'update') {
        updated.ids = (ops.inFilter?.values as string[]) ?? null
        updated.status = (ops.payload as { status: string }).status
        return { error: null }
      }
      return { data: fx.messages, error: null }
    }
    if (table === 'conversations') {
      const acct = ops.filters.find((f) => f[0] === 'account_id')?.[1]
      const want = (ops.inFilter?.values as string[]) ?? []
      const rows = fx.conversations
        .filter((c) => c.account_id === acct && want.includes(c.id))
        .map((c) => ({ id: c.id }))
      return { data: rows, error: null }
    }
    return { data: null, error: null }
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      payload: undefined as unknown,
      filters: [] as [string, unknown][],
      inFilter: undefined as { col: string; values: unknown[] } | undefined,
    }
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push([k, v]), b),
      in: (col: string, values: unknown[]) => ((ops.inFilter = { col, values }), b),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = { from: (t: string) => builder(t) }
  return { db, updated }
}

const PN = 'PN-A' // account A's number

describe('mirrorMessageStatus — account isolation', () => {
  it('updates only the owning account’s message on a colliding message_id', async () => {
    // Same message_id 'wamid-x' exists in BOTH accounts (migration 009).
    const { db, updated } = makeDb({
      config: { account_id: 'A' },
      messages: [
        { id: 'msgA', conversation_id: 'convA' },
        { id: 'msgB', conversation_id: 'convB' },
      ],
      conversations: [
        { id: 'convA', account_id: 'A' },
        { id: 'convB', account_id: 'B' },
      ],
    })

    await mirrorMessageStatus(db, { messageId: 'wamid-x', status: 'read', phoneNumberId: PN })

    // Only account A's row is touched — B's colliding row is untouched.
    expect(updated.ids).toEqual(['msgA'])
    expect(updated.status).toBe('read')
  })

  it('writes nothing when the number does not resolve to an account (fail closed)', async () => {
    const { db, updated } = makeDb({
      config: null,
      messages: [{ id: 'msgB', conversation_id: 'convB' }],
      conversations: [{ id: 'convB', account_id: 'B' }],
    })
    await mirrorMessageStatus(db, { messageId: 'wamid-x', status: 'read', phoneNumberId: 'unknown' })
    expect(updated.ids).toBeNull()
  })

  it('writes nothing when phoneNumberId is absent', async () => {
    const { db, updated } = makeDb({
      config: { account_id: 'A' },
      messages: [{ id: 'msgA', conversation_id: 'convA' }],
      conversations: [{ id: 'convA', account_id: 'A' }],
    })
    await mirrorMessageStatus(db, { messageId: 'wamid-x', status: 'read' })
    expect(updated.ids).toBeNull()
  })

  it('writes nothing when the id matches no message', async () => {
    const { db, updated } = makeDb({
      config: { account_id: 'A' },
      messages: [],
      conversations: [{ id: 'convA', account_id: 'A' }],
    })
    await mirrorMessageStatus(db, { messageId: 'nope', status: 'read', phoneNumberId: PN })
    expect(updated.ids).toBeNull()
  })
})
