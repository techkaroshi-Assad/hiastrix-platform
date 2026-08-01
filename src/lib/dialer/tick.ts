/**
 * One heartbeat — SERVER ONLY.
 *
 * The webhook is the pump: every call that ends starts the next one. So in
 * steady state this arrives to find full pipelines, claims nothing, and costs a
 * handful of indexed queries.
 *
 * It exists for the four cases the pump cannot cover:
 *
 *   · a campaign with nothing in flight has nothing to be pumped by — somebody
 *     has to start it
 *   · leases expire and have to be resolved
 *   · leads deferred outside the calling window have to be let back in
 *   · anything `after()` dropped has to be picked up
 *
 * It is therefore sized for a cold start and a repair, not for throughput. If
 * more throughput is needed, the answer is a higher per-campaign concurrency so
 * the pump does more — not a longer tick doing more on one instance with five
 * database connections.
 */

import { prisma } from "@/lib/prisma"
import { advanceCampaign } from "@/lib/dialer/advance"
import { reapExpiredLeases } from "@/lib/dialer/reap"
import { takeCampaignsForTick, releaseDeferred } from "@/lib/dialer/claim"
import { reconcileAvailability } from "@/lib/agents/reconcile"
import {
  TICK_DEADLINE_MS,
  MAX_CAMPAIGNS_PER_TICK,
  MAX_DIALS_PER_TICK,
  MAX_REAPS_PER_TICK,
  BATCH_CEILING,
} from "@/lib/dialer/config"

export type TickResult = {
  campaigns: number
  dialed: number
  completed: number
  reaped: { reclaimed: number; stillLive: number; lost: number; unresolved: number }
  deferredReleased: number
  /** True when the tick ran out of time. Work is never stranded — only delayed. */
  deadlineHit: boolean
  /** Set when the platform switch is off; nothing else ran. */
  halted?: string
}

export async function runHeartbeat(now = Date.now()): Promise<TickResult> {
  const deadline = now + TICK_DEADLINE_MS

  const result: TickResult = {
    campaigns: 0, dialed: 0, completed: 0,
    reaped: { reclaimed: 0, stillLive: 0, lost: 0, unresolved: 0 },
    deferredReleased: 0, deadlineHit: false,
  }

  // The 2am switch. Checked first and cheaply, so turning it off actually stops
  // things rather than merely stopping new campaigns.
  const settings = await prisma.platformSettings.findFirst({ where: { id: true } })
  if (settings && settings.dialerEnabled === false) {
    return { ...result, halted: "The dialer is switched off platform-wide." }
  }

  /*
   * Before any dialling: is everybody who is switched on entitled to be?
   *
   * Outbound is gated at the point of dialling, so this is not about the
   * dialler — it is about inbound, which the provider answers before we hear a
   * word about it. The only thing that can stop an inbound call is the phone
   * number not pointing at the assistant, and that is a fact stored in someone
   * else's database. Facts stored elsewhere drift.
   *
   * The money check is pure database work and runs every tick. Re-asserting the
   * detachment upstream costs provider calls, so it runs on the hour's tenth
   * minute — often enough that a gap is minutes rather than months, rarely
   * enough to be invisible in the bill.
   */
  try {
    const deep = new Date(now).getUTCMinutes() % 10 === 0
    const rec  = await reconcileAvailability(deep)
    if (rec.disabled || rec.reasserted || rec.campaignsPaused) {
      console.warn("[dialer/tick] availability reconciled", rec)
    }
  } catch (err) {
    // Never let this stop the dialling it runs in front of.
    console.error("[dialer/tick] reconcile", err)
  }

  /*
   * Reap first.
   *
   * Concurrency counts ignore expired leases, so a stuck attempt has already
   * stopped holding its slot — but the lead is still sitting in DIALING and
   * cannot be claimed by anyone. Resolving those before claiming is what keeps
   * that window down to one tick.
   */
  result.reaped = await reapExpiredLeases(MAX_REAPS_PER_TICK, deadline)

  // One statement for the whole platform, so nobody is left waiting a tick per
  // campaign for their window to reopen.
  result.deferredReleased = await releaseDeferred()

  const campaigns = await takeCampaignsForTick(MAX_CAMPAIGNS_PER_TICK)
  result.campaigns = campaigns.length

  for (const campaignId of campaigns) {
    if (Date.now() > deadline) { result.deadlineHit = true; break }
    if (result.dialed >= MAX_DIALS_PER_TICK) break

    const room = Math.min(BATCH_CEILING, MAX_DIALS_PER_TICK - result.dialed)

    try {
      const { dialed, drained } = await advanceCampaign(campaignId, { deadline, maxDials: room })
      result.dialed += dialed
      if (drained) result.completed++
    } catch (err) {
      // One campaign failing must not take the rest of the platform's dialing
      // with it. Logged and skipped; its leads keep their leases and are picked
      // up next tick.
      console.error(`[dialer/tick] campaign ${campaignId}`, err)
    }
  }

  return result
}
