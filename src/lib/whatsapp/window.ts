// ------------------------------------------------------------
// WhatsApp 24-hour customer-care window (Constitution Principle III —
// permanent product constraint). Outside 24h from the customer's last
// inbound message, Meta only accepts template messages; free-form text /
// media / interactive are rejected (error 131047).
//
// The window is derived from conversations.last_inbound_at (migration
// 500), maintained by the webhook. All math is UTC — timestamps come from
// the server / DB, never the client (spec 005, FR-008).
// ------------------------------------------------------------

/** 24 hours in milliseconds. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Is the 24-hour service window open for a conversation?
 *
 * @param lastInboundAt ISO timestamp of the last customer message, or
 *   null/undefined when the conversation has never received one.
 * @param now reference time (defaults to Date.now()); injectable for tests.
 * @returns true only when an inbound exists and is younger than 24h.
 *   Never-inbound (null) is treated as CLOSED — matches Meta's rule.
 */
export function isWindowOpen(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  if (Number.isNaN(t)) return false;
  return now - t < WINDOW_MS;
}
