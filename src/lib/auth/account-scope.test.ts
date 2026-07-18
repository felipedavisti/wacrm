import { describe, it, expect } from 'vitest'
import { requireAccountScope } from './account-scope'

describe('requireAccountScope', () => {
  it('returns the account id when present', () => {
    expect(requireAccountScope('acct-1')).toBe('acct-1')
  })

  it('throws on null / undefined / blank (fails closed)', () => {
    expect(() => requireAccountScope(null)).toThrow(/account scope required/)
    expect(() => requireAccountScope(undefined)).toThrow(/account scope required/)
    expect(() => requireAccountScope('')).toThrow(/account scope required/)
    expect(() => requireAccountScope('   ')).toThrow(/account scope required/)
  })
})
