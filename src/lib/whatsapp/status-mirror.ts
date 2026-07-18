import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Account-scoped mirror of a Meta delivery-status event onto
// messages.status.
//
// Why this exists (docs/service-role-inventory.md, ponto 2): the webhook
// handler ran `messages.update({status}).eq('message_id', id)` with the
// service-role client and NO account scope. `message_id` is NOT unique
// across accounts (migration 009 — Meta ids repeat across numbers), so a
// colliding id would flip the status of another tenant's message.
//
// The number the event arrived on (`phone_number_id`) is unique per
// account (migration 013), so it resolves the owning account. We then
// update only the messages whose conversation belongs to that account.
// Fails closed: an unknown/absent number writes nothing.
//
// Extracted into this module (rather than inlined in the hot webhook
// route) to keep the upstream-merge surface of route.ts minimal —
// Constitution Principle V. Deliberate divergence from upstream.
// ------------------------------------------------------------

export async function mirrorMessageStatus(
  db: SupabaseClient,
  args: { messageId: string; status: string; phoneNumberId?: string | null },
): Promise<void> {
  const { messageId, status, phoneNumberId } = args
  if (!phoneNumberId) return

  // Resolve the owning account from the (unique) number.
  const { data: cfg } = await db
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()
  const accountId = cfg?.account_id
  if (!accountId) return

  // Candidate rows on this Meta id (may include other accounts' rows).
  const { data: msgs, error: findErr } = await db
    .from('messages')
    .select('id, conversation_id')
    .eq('message_id', messageId)
  if (findErr) {
    console.error('Error finding message for status update:', findErr)
    return
  }
  if (!msgs || msgs.length === 0) return

  // Keep only the rows whose conversation belongs to this account.
  const convIds = [...new Set(msgs.map((m) => m.conversation_id))]
  const { data: convs, error: convErr } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .in('id', convIds)
  if (convErr) {
    console.error('Error scoping message status update:', convErr)
    return
  }
  const own = new Set((convs ?? []).map((c) => c.id))
  const ids = msgs.filter((m) => own.has(m.conversation_id)).map((m) => m.id)
  if (ids.length === 0) return

  const { error: updErr } = await db
    .from('messages')
    .update({ status })
    .in('id', ids)
  if (updErr) console.error('Error updating message status:', updErr)
}
