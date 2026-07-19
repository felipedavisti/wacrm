import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

// ------------------------------------------------------------
// Candidate Meta App Secrets for webhook signature verification
// (spec 007 — multi-app). The App Secret belongs to the Meta App, and a
// deployment can have numbers across several Apps, so verification must try
// every App's secret (see verifyMetaWebhookSignature's try-all-secrets).
//
// Extracted into this module (not inlined in the hot webhook route) to keep
// the upstream-merge surface of route.ts small — Constitution Principle V.
// ------------------------------------------------------------

/**
 * Collect the distinct App Secrets to try when authenticating a webhook POST:
 * the per-App secrets in `meta_apps` (decrypted) plus the single-app
 * `META_APP_SECRET` env var as a backward-compat fallback (accounts not yet
 * migrated to meta_apps, and the transition window).
 *
 * Degrades gracefully: if the `meta_apps` query fails — e.g. the table
 * doesn't exist yet, before migration 501 is applied — it falls back to the
 * env secret alone, so the webhook keeps working either side of the migration.
 */
export async function loadWebhookAppSecrets(
  db: SupabaseClient,
): Promise<string[]> {
  const secrets: string[] = []

  const { data, error } = await db.from('meta_apps').select('app_secret')
  if (!error) {
    for (const row of (data ?? []) as { app_secret: string }[]) {
      try {
        secrets.push(decrypt(row.app_secret))
      } catch (e) {
        // A single bad ciphertext must not take down verification for the
        // other Apps — skip it and keep going (fail closed on that one).
        console.error('[webhook] failed to decrypt a meta_apps app_secret', e)
      }
    }
  }

  if (process.env.META_APP_SECRET) secrets.push(process.env.META_APP_SECRET)

  return [...new Set(secrets)]
}
