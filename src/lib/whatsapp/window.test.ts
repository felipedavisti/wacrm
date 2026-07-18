import { describe, it, expect } from 'vitest';
import { isWindowOpen, latestInboundAnchor, WINDOW_MS } from './window';

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

describe('latestInboundAnchor', () => {
  const older = '2026-07-17T00:00:00Z';
  const newer = '2026-07-18T00:00:00Z';
  const msg = (sender_type: string, created_at: string) => ({ sender_type, created_at });

  it('returns last_inbound_at when it is the most recent', () => {
    expect(
      latestInboundAnchor(newer, [msg('customer', older), msg('agent', newer)]),
    ).toBe(newer);
  });

  it('returns the loaded customer message when it is more recent (reopen case)', () => {
    // The conversation row still has the stale (older) last_inbound_at, but a
    // newer inbound just landed in the thread — the window must reopen.
    expect(latestInboundAnchor(older, [msg('customer', newer)])).toBe(newer);
  });

  it('falls back to messages when last_inbound_at is null/undefined', () => {
    expect(latestInboundAnchor(null, [msg('customer', newer)])).toBe(newer);
    expect(latestInboundAnchor(undefined, [msg('customer', older)])).toBe(older);
  });

  it('uses last_inbound_at when no customer message is loaded', () => {
    expect(latestInboundAnchor(older, [msg('agent', newer)])).toBe(older);
  });

  it('returns null when there is no anchor from either source', () => {
    expect(latestInboundAnchor(null, [])).toBeNull();
    expect(latestInboundAnchor(undefined, [msg('agent', newer)])).toBeNull();
  });
});
