/**
 * Shared-secret check for anything the voice provider posts to us.
 *
 * Two endpoints depend on this — the call lifecycle webhook and the CRM tool
 * endpoint — and they must not drift, because one of them can write into a
 * customer's CRM. Same trust boundary, same secret, one implementation.
 *
 * Fails closed when the secret is unset: an environment that forgot to configure
 * it rejects everything rather than accepting anything.
 */

import { timingSafeEqual } from "node:crypto"

function matches(presented: string, expected: string | undefined): boolean {
  if (!expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  // Length is compared first out of necessity — timingSafeEqual throws on a
  // mismatch — which leaks the length of the secret and nothing else.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function presented(request: Request): string {
  return (
    request.headers.get("x-vapi-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  )
}

export function authorisedByVapiSecret(request: Request): boolean {
  return matches(presented(request), process.env.VAPI_WEBHOOK_SECRET)
}

/**
 * The scheduler's own secret, checked the same way.
 *
 * A separate secret from the provider's, because the two callers are unrelated:
 * one is a vendor posting call events, the other is our own scheduler asking us
 * to spend a tenant's money. Sharing a secret between them means rotating either
 * one breaks both.
 */
export function authorisedByCronSecret(request: Request): boolean {
  return matches(presented(request), process.env.CRON_SECRET)
}
