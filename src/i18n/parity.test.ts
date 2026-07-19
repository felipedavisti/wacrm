import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Locale-dictionary key parity (spec 002, FR-002/FR-007). The dictionaries
// must have identical key sets so no locale silently misses a string the
// code references — the bug this feature fixed. This test is the gate that
// keeps them from diverging again (Constitution Principle VII).
//
// Read via fs (cwd = repo root under vitest) so a malformed/missing locale
// file fails loudly here rather than at module import.
function loadLocale(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`messages/${name}.json`, 'utf8'));
}

/** Flatten a nested dictionary into the set of leaf dot-paths. */
function leafKeys(obj: unknown, prefix = '', acc = new Set<string>()): Set<string> {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      leafKeys(v, prefix ? `${prefix}.${k}` : k, acc);
    }
  } else {
    acc.add(prefix);
  }
  return acc;
}

describe('i18n locale parity', () => {
  it('en.json and pt.json have identical key sets', () => {
    const en = leafKeys(loadLocale('en'));
    const pt = leafKeys(loadLocale('pt'));

    const missingInPt = [...en].filter((k) => !pt.has(k)).sort();
    const missingInEn = [...pt].filter((k) => !en.has(k)).sort();

    // Assert on the arrays (not just lengths) so a failure names the keys.
    expect(missingInPt).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('the parity check actually detects a divergence (guard)', () => {
    const a = leafKeys({ x: '1', y: { z: '2' } });
    const b = leafKeys({ x: '1' });
    expect([...a].filter((k) => !b.has(k))).toEqual(['y.z']);
    expect([...b].filter((k) => !a.has(k))).toEqual([]);
  });
});
