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

export function authorisedByVapiSecret(request: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET
  if (!expected) return false

  const header =
    request.headers.get("x-vapi-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""

  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  // Length is compared first out of necessity — timingSafeEqual throws on a
  // mismatch — which leaks the length of the secret and nothing else.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
