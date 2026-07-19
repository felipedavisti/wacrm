import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   `META_APP_SECRET` is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 *
 * Multi-app (spec 007): a deployment can have numbers across several Meta
 * Apps, each with its own App Secret. We try every candidate secret against
 * the raw body until one matches (the same try-all pattern the GET verify
 * uses with verify tokens). Pass the `secrets` explicitly for that; when
 * omitted, it falls back to the single `META_APP_SECRET` env var
 * (backward-compat with single-app deployments). Empty candidate set → fail
 * closed (reject), never fall open.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secrets?: string[],
): boolean {
  const candidates =
    secrets ??
    (process.env.META_APP_SECRET ? [process.env.META_APP_SECRET] : [])

  if (candidates.length === 0) {
    console.error(
      '[webhook] no Meta App secret available — rejecting request. ' +
        'Configure META_APP_SECRET or a meta_apps row to enable ' +
        'signature verification.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  // Fail closed: true only if SOME secret produces the presented signature.
  return candidates.some((secret) =>
    signatureMatches(rawBody, signatureHeader, secret),
  )
}

function signatureMatches(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
