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

/**
 * Resolve the window anchor from the two sources the inbox has: the
 * conversation's backend-maintained `last_inbound_at`, and the most recent
 * customer message currently loaded in the thread.
 *
 * Returns the MORE RECENT of the two (or null if neither exists). Using the
 * max is what makes reopening robust (spec 005, SC-004): a customer message
 * arriving in an open thread lands in `messages` via realtime immediately,
 * so the window reopens even before the parent's conversation row (and its
 * `last_inbound_at`) has refreshed.
 */
export function latestInboundAnchor(
  lastInboundAt: string | null | undefined,
  messages: { sender_type: string; created_at: string }[],
): string | null {
  const fromMessages = [...messages]
    .reverse()
    .find((m) => m.sender_type === 'customer')?.created_at;
  const candidates = [lastInboundAt, fromMessages].filter(
    (v): v is string => !!v,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}
