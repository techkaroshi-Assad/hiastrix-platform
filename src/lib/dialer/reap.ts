/**
 * Resolving calls we have lost track of — SERVER ONLY.
 *
 * ── THE RULE THIS MODULE EXISTS TO ENFORCE ────────────────────────────
 *
 *     A lease expiring never causes a dial. It only ever causes a question.
 *
 * A lease running out is not evidence that a call is dead. It is evidence that
 * we do not know, and the only thing that resolves that is asking the provider.
 * Re-dialling on a timer is how a dialer rings somebody twice while they are
 * still on the phone to it.
 *
 * Three things arrive here:
 *
 *   · a call that ended without a webhook, or whose webhook we dropped
 *   · a call still perfectly alive, whose lease was simply too short
 *   · an attempt with no provider call id at all — the dial went out and the
 *     response never came back
 *
 * The third is the interesting one, and it is why `dial_attempts` rows are
 * written before the provider is called.
 */

import { prisma } from "@/lib/prisma"
import { VapiNotFound, vapiCalls } from "@/lib/vapi/client"
import { releaseAttempt, markAttemptConnected } from "@/lib/dialer/advance"
import {
  RECONCILE_LEASE_SECONDS,
  TALK_LEASE_MARGIN_SECONDS,
  ATTRIBUTION_GRACE_MS,
  PROVIDER_TIMEOUT_MS,
} from "@/lib/dialer/config"

type Expired = {
  id: string
  campaign_id: string
  campaign_lead_id: string
  tenant_id: string
  provider_call_id: string | null
  phone_e164: string
  attempt_no: number
  created_at: Date
}

/**
 * Take expired attempts, atomically, so several reapers can run at once.
 *
 * Same shape as the claim: one statement, SKIP LOCKED, and a fresh lease stamped
 * on the way out so a second reaper walks straight past rows this one is already
 * asking about.
 */
async function takeExpired(limit: number): Promise<Expired[]> {
  return prisma.$queryRaw<Expired[]>`
    UPDATE dial_attempts a
       SET state            = 'RECONCILING',
           lease_expires_at = now() + (${RECONCILE_LEASE_SECONDS}::int * interval '1 second')
      FROM (
        SELECT id FROM dial_attempts
         WHERE state IN ('PLACING','DIALING','IN_PROGRESS')
           AND lease_expires_at < now()
         ORDER BY lease_expires_at
         FOR UPDATE SKIP LOCKED
         LIMIT ${limit}::int
      ) d
     WHERE a.id = d.id
    RETURNING a.id, a.campaign_id, a.campaign_lead_id, a.tenant_id,
              a.provider_call_id, a.phone_e164, a.attempt_no, a.created_at
  `
}

export type ReapResult = {
  reclaimed: number
  stillLive: number
  lost: number
  unresolved: number
}

export async function reapExpiredLeases(
  limit: number,
  deadline?: number
): Promise<ReapResult> {
  const rows = await takeExpired(limit)
  const out: ReapResult = { reclaimed: 0, stillLive: 0, lost: 0, unresolved: 0 }

  for (const row of rows) {
    if (deadline && Date.now() > deadline) {
      out.unresolved++
      continue
    }

    /* ── No call id: the dial went out, the answer did not come back ──── */
    if (!row.provider_call_id) {
      const resolved = await attributeByListing(row)
      if (resolved) { out.reclaimed++; continue }

      if (Date.now() - new Date(row.created_at).getTime() < ATTRIBUTION_GRACE_MS) {
        // Keep looking on the next tick. The provider's own list can lag.
        out.unresolved++
        continue
      }

      /*
       * Give up, carefully.
       *
       * The attempt is marked LOST and the lead goes back to the queue with the
       * attempt STILL COUNTED. Never uncounted: we may well have called this
       * person, and ringing someone twice is a worse outcome than ringing them
       * once. Counting it also means exhaustion still terminates the lead rather
       * than looping forever.
       */
      await prisma.$transaction([
        prisma.dialAttempt.update({
          where: { id: row.id },
          data:  { state: "LOST", error: "no provider call id could be attributed" },
        }),
        prisma.campaignLead.updateMany({
          where: { id: row.campaign_lead_id, state: { in: ["DIALING", "IN_PROGRESS"] } },
          data: {
            state: "RETRY_WAIT",
            nextAttemptAt: new Date(Date.now() + 30 * 60_000),
            leaseExpiresAt: null,
            lastOutcome: "LOST",
            note: "We couldn't confirm this call went through. It will be retried later.",
          },
        }),
      ])
      out.lost++
      continue
    }

    /* ── We have a call id, so ask ────────────────────────────────────── */
    try {
      const call = await vapiCalls.get(row.provider_call_id, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })

      if (call.status === "ended") {
        const started = call.startedAt ? new Date(call.startedAt).getTime() : null
        const ended   = call.endedAt   ? new Date(call.endedAt).getTime()   : null
        const seconds = started && ended ? Math.max(0, Math.round((ended - started) / 1000)) : 0

        // Back out of RECONCILING first, so releaseAttempt's own guard against
        // terminal states does not refuse the work it is here to do.
        await prisma.dialAttempt.updateMany({
          where: { id: row.id, state: "RECONCILING" },
          data:  { state: "DIALING" },
        })
        await releaseAttempt({
          providerCallId: row.provider_call_id,
          endedReason: call.endedReason ?? null,
          durationSeconds: seconds,
        })
        out.reclaimed++
        continue
      }

      // Queued, ringing, or talking. The lease was short, that is all. Extend
      // it and leave the lead exactly where it is.
      const live = call.status === "in-progress" || call.status === "forwarding"
      const lease = new Date(
        Date.now() + (live ? 600 + TALK_LEASE_MARGIN_SECONDS : 90) * 1000
      )
      await prisma.$transaction([
        prisma.dialAttempt.updateMany({
          where: { id: row.id, state: "RECONCILING" },
          data:  { state: live ? "IN_PROGRESS" : "DIALING", leaseExpiresAt: lease },
        }),
        prisma.campaignLead.updateMany({
          where: { id: row.campaign_lead_id, state: { in: ["DIALING", "IN_PROGRESS"] } },
          data:  { state: live ? "IN_PROGRESS" : "DIALING", leaseExpiresAt: lease },
        }),
      ])
      out.stillLive++
    } catch (err) {
      if (err instanceof VapiNotFound) {
        /*
         * The provider has never heard of it. This is the one case where the
         * attempt can be handed back in full — the call demonstrably does not
         * exist, so nobody was rung.
         */
        await prisma.$transaction([
          prisma.dialAttempt.update({
            where: { id: row.id },
            data:  { state: "LOST", error: "the provider has no record of this call" },
          }),
          prisma.campaignLead.updateMany({
            where: { id: row.campaign_lead_id, state: { in: ["DIALING", "IN_PROGRESS"] } },
            data: {
              state: "PENDING",
              attemptNo: { decrement: 1 },
              nextAttemptAt: new Date(),
              leaseExpiresAt: null,
            },
          }),
        ])
        out.lost++
        continue
      }

      // Provider unreachable. Leave it RECONCILING with its extended lease and
      // ask again next tick. Guessing here would either strand a live call or
      // re-dial someone already talking to us.
      out.unresolved++
    }
  }

  return out
}

/**
 * Last-ditch attribution for a dial whose create response was lost.
 *
 * Ask the provider for its recent calls and look for the number we rang. If
 * exactly one matches inside the window, it is ours. More than one and we do not
 * guess — two calls to the same number in the same minute is precisely the
 * situation where a wrong guess causes a double dial.
 *
 * The filter parameters are not documented, so this tries them and falls back to
 * an unfiltered page rather than assuming either way.
 */
async function attributeByListing(row: Expired): Promise<boolean> {
  const since = new Date(new Date(row.created_at).getTime() - 30_000)

  let calls
  try {
    calls = await vapiCalls.list(
      { limit: "100", createdAtGe: since.toISOString() },
      { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) }
    )
  } catch {
    try {
      calls = await vapiCalls.list({ limit: "100" }, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
    } catch {
      return false
    }
  }

  if (!Array.isArray(calls)) return false

  const matches = calls.filter(c => {
    if (c.metadata?.astrixAttemptId === row.id) return true
    if (c.customer?.number !== row.phone_e164) return false
    const at = c.startedAt ? new Date(c.startedAt).getTime() : null
    return at !== null && Math.abs(at - new Date(row.created_at).getTime()) < 120_000
  })

  if (matches.length !== 1) return false

  const call = matches[0]

  // Claim the id, but only if nobody else has. The partial unique index would
  // reject a second attempt taking the same call, and updateMany turns that into
  // "wrote nothing" rather than a throw inside a background tick.
  const written = await prisma.dialAttempt.updateMany({
    where: { id: row.id, providerCallId: null },
    data:  { providerCallId: call.id },
  })
  if (written.count === 0) return false

  if (call.status === "ended") {
    await prisma.dialAttempt.updateMany({
      where: { id: row.id, state: "RECONCILING" },
      data:  { state: "DIALING" },
    })
    const started = call.startedAt ? new Date(call.startedAt).getTime() : null
    const ended   = call.endedAt   ? new Date(call.endedAt).getTime()   : null
    await releaseAttempt({
      providerCallId: call.id,
      endedReason: call.endedReason ?? null,
      durationSeconds: started && ended ? Math.max(0, Math.round((ended - started) / 1000)) : 0,
    })
  } else {
    await markAttemptConnected({ providerCallId: call.id })
  }

  return true
}
