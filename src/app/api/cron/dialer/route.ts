/**
 * GET /api/cron/dialer — the heartbeat.
 *
 * Runs every minute. Most of the time it finds nothing to do: the Vapi webhook
 * starts the next call the moment one ends, so a healthy campaign never waits
 * for this. It is here for cold starts, expired leases, calling windows
 * reopening, and anything the pump dropped.
 *
 * Authenticated on CRON_SECRET, compared in constant time and failing closed
 * when unset — see lib/vapi/webhook-auth.ts. Vercel sends it as a bearer token.
 *
 * `api/cron` is excluded from the proxy matcher in src/proxy.ts. Without that
 * exclusion every tick would call the auth provider to resolve a session that
 * does not exist, making the dialer depend on something it has no business
 * depending on.
 */

import { NextRequest } from "next/server"
import { runHeartbeat } from "@/lib/dialer/tick"
import { authorisedByCronSecret } from "@/lib/vapi/webhook-auth"
import { TICK_MAX_DURATION_SECONDS } from "@/lib/dialer/config"

export const dynamic = "force-dynamic"

// Declared rather than inherited. The tick holds its own deadline well inside
// this, so it finishes tidily instead of being killed holding claimed work.
export const maxDuration = TICK_MAX_DURATION_SECONDS

export async function GET(request: NextRequest) {
  if (!authorisedByCronSecret(request)) {
    return new Response(null, { status: 401 })
  }

  try {
    const result = await runHeartbeat()

    // Logged as one line per tick so a quiet minute is one line and a busy one
    // is still one line. This is the only visibility into the dialer's pacing.
    console.log("[dialer/tick]", JSON.stringify(result))

    return Response.json(result)
  } catch (error) {
    console.error("[dialer/tick]", error)
    // A bare 500. The scheduler does not need detail, and nobody signed in is
    // reading this.
    return new Response(null, { status: 500 })
  }
}
