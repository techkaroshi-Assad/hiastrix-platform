/**
 * GET /api/cron/dialer — the heartbeat.
 *
 * Runs every minute. Most of the time it finds nothing to do: the Vapi webhook
 * starts the next call the moment one ends, so a healthy campaign never waits
 * for this. It is here for cold starts, expired leases, calling windows
 * reopening, and anything the pump dropped.
 *
 * Authenticated on CRON_SECRET, compared in constant time and failing closed
 * when unset — see lib/vapi/webhook-auth.ts. The caller sends it as a bearer
 * token.
 *
 * ── WHO CALLS THIS ────────────────────────────────────────────────────
 *
 * pg_cron, from inside Supabase — not a Vercel cron. Vercel's Hobby plan caps
 * cron jobs at once a day, and an every-minute schedule in vercel.json is
 * rejected during configuration validation, which stops the deployment from
 * being *created* rather than failing the build. A push that appears to have
 * vanished. Scheduling it in Postgres instead costs nothing, runs in the same
 * region as the database, and survives a plan change.
 *
 * See sql/2026-07-28-dialer-heartbeat.sql.
 *
 * `api/cron` is excluded from the proxy matcher in src/proxy.ts. Without that
 * exclusion every tick would call the auth provider to resolve a session that
 * does not exist, making the dialer depend on something it has no business
 * depending on.
 */

import { NextRequest } from "next/server"
import { runHeartbeat } from "@/lib/dialer/tick"
import { authorisedByCronSecret } from "@/lib/vapi/webhook-auth"

export const dynamic = "force-dynamic"

/**
 * Declared rather than inherited: the tick holds its own deadline well inside
 * this, so it finishes tidily instead of being killed holding claimed work.
 *
 * Written as a literal on purpose. Route segment config is read by statically
 * analysing this file at build time, before any module is evaluated, so an
 * imported constant here is not a constant as far as Next is concerned — it
 * fails the build with "Invalid segment configuration export detected", which
 * TypeScript cannot see because the types are perfectly fine.
 *
 * Keep it equal to TICK_MAX_DURATION_SECONDS in lib/dialer/config.ts, which is
 * what the tick actually paces itself against.
 */
export const maxDuration = 60

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
