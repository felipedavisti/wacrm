import { describe, it, expect } from 'vitest';
import { isWindowOpen, WINDOW_MS } from './window';

// Fixed reference "now" so the math is deterministic (UTC).
const NOW = Date.parse('2026-07-18T12:00:00Z');

describe('isWindowOpen', () => {
  it('is open when the last inbound was under 24h ago', () => {
    const oneHourAgo = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(isWindowOpen(oneHourAgo, NOW)).toBe(true);
  });

  it('is closed when the last inbound was over 24h ago', () => {
    const twentyFiveHoursAgo = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
    expect(isWindowOpen(twentyFiveHoursAgo, NOW)).toBe(false);
  });

  it('is closed exactly at the 24h boundary (strictly less than)', () => {
    const exactly24h = new Date(NOW - WINDOW_MS).toISOString();
    expect(isWindowOpen(exactly24h, NOW)).toBe(false);
    const justUnder = new Date(NOW - WINDOW_MS + 1000).toISOString();
    expect(isWindowOpen(justUnder, NOW)).toBe(true);
  });

  it('is closed when there has never been an inbound (null/undefined)', () => {
    expect(isWindowOpen(null, NOW)).toBe(false);
    expect(isWindowOpen(undefined, NOW)).toBe(false);
  });

  it('is closed on an unparseable timestamp (fail closed)', () => {
    expect(isWindowOpen('not-a-date', NOW)).toBe(false);
  });
});
