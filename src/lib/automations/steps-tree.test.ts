import { describe, it, expect, vi, beforeEach } from 'vitest'

// Isolation proof for the automation_steps service_role path (spec 006,
// T004 + ponto 1 do inventário): steps operations must refuse an
// automation that doesn't belong to the caller's account. The account
// that owns the fixture automation is 'A'.

const h = vi.hoisted(() => ({
  state: {
    ownerAccount: 'A',
    stepsInserted: 0,
    stepsDeleted: 0,
  },
}))

vi.mock('./admin-client', () => {
  const { state } = h
  function resolve(ops: { table: string; type: string; filters: [string, unknown][] }) {
    const { table, type, filters } = ops
    if (table === 'automations') {
      // Ownership lookup: only resolves when the account_id filter matches
      // the automation's true owner.
      const acct = filters.find((f) => f[0] === 'account_id')?.[1]
      return { data: acct === state.ownerAccount ? { id: 'auto-1' } : null, error: null }
    }
    if (table === 'automation_steps') {
      if (type === 'delete') return (state.stepsDeleted++, { error: null })
      if (type === 'insert') return (state.stepsInserted++, { error: null })
      return { data: [], error: null } // select for loadStepsTree
    }
    return { data: null, error: null }
  }
  function builder(table: string) {
    const ops = { table, type: 'select', filters: [] as [string, unknown][] }
    const b: Record<string, unknown> = {
      select: () => b,
      insert: () => ((ops.type = 'insert'), b),
      delete: () => ((ops.type = 'delete'), b),
      eq: (k: string, v: unknown) => (ops.filters.push([k, v]), b),
      order: () => b,
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    }
    return b
  }
  return { supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }
})

import { replaceSteps, insertSteps, loadStepsTree } from './steps-tree'

const STEPS = [{ step_type: 'send_message', step_config: { text: 'hi' } }]

beforeEach(() => {
  h.state.ownerAccount = 'A'
  h.state.stepsInserted = 0
  h.state.stepsDeleted = 0
})

describe('steps-tree — account isolation', () => {
  it('loadStepsTree succeeds for the owning account', async () => {
    await expect(loadStepsTree('auto-1', 'A')).resolves.toEqual([])
  })

  it('loadStepsTree refuses another account', async () => {
    await expect(loadStepsTree('auto-1', 'B')).rejects.toThrow(
      'automation not found for this account',
    )
  })

  it('insertSteps refuses another account and writes nothing', async () => {
    await expect(insertSteps('auto-1', 'B', STEPS)).rejects.toThrow(
      'automation not found for this account',
    )
    expect(h.state.stepsInserted).toBe(0)
  })

  it('replaceSteps refuses another account (no delete, no insert)', async () => {
    await expect(replaceSteps('auto-1', 'B', STEPS)).rejects.toThrow(
      'automation not found for this account',
    )
    expect(h.state.stepsDeleted).toBe(0)
    expect(h.state.stepsInserted).toBe(0)
  })

  it('insertSteps for the owner writes the rows', async () => {
    const err = await insertSteps('auto-1', 'A', STEPS)
    expect(err).toBeNull()
    expect(h.state.stepsInserted).toBe(1)
  })

  it('fails closed when accountId is blank (requireAccountScope)', async () => {
    await expect(insertSteps('auto-1', '', STEPS)).rejects.toThrow(/account scope required/)
    expect(h.state.stepsInserted).toBe(0)
  })
})
