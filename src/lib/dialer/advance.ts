/**
 * Closing one attempt and starting the next — SERVER ONLY.
 *
 * This is the pump. In steady state the cron heartbeat finds nothing to do,
 * because every call that ends starts the next one from right here.
 *
 * ── THE ONE ORDERING RULE ─────────────────────────────────────────────
 *
 * In the webhook, `releaseAttempt` runs first and inline, `processCallEnded`
 * second and inline, and `advanceCampaign` last and inside `after()`.
 *
 * Releasing first because it is one indexed UPDATE and it frees a concurrency
 * slot — and `processCallEnded` awaits email sends, so a slot must not be held
 * hostage to an SMTP round trip.
 *
 * Advancing inside `after()` because it makes up to eight provider calls. On the
 * webhook's critical path that is the likeliest cause of a timeout, and a
 * webhook timeout means the provider retries, which means a second advance,
 * which means more load. `after()` quietly dropping an error is survivable here
 * and nowhere else: the worst case is a campaign idle for sixty seconds until
 * the heartbeat notices. Billing has no such backstop, which is why it stays
 * inline.
 */

import { prisma } from "@/lib/prisma"
import { classifyOutcome, scheduleNext, withinWindow, nextWindowOpen } from "@/lib/dialer/outcome"
import { claimDueLeads, releaseClaimed, campaignIsDrained } from "@/lib/dialer/claim"
import { loadCampaignContext } from "@/lib/dialer/context"
import { placeCall } from "@/lib/dialer/dial"
import {
  BATCH_CEILING,
  DIAL_CONCURRENCY,
  TALK_LEASE_MARGIN_SECONDS,
} from "@/lib/dialer/config"

/** Attempt states that are finished and must never be reopened. */
const TERMINAL_ATTEMPT = ["ENDED", "LOST"] as const

/**
 * Find the attempt behind a provider call.
 *
 * By the provider's own call id first, and by the attempt id we sent as metadata
 * second. The second path exists for the case where the create response never
 * reached us: the call is live, we never learned its id, but the provider is
 * echoing back the identifier we gave it.
 */
async function findAttempt(a: { providerCallId: string; metadata?: Record<string, unknown> | null }) {
  const byCallId = await prisma.dialAttempt.findFirst({
    where:  { providerCallId: a.providerCallId },
    select: { id: true, state: true, campaignId: true, campaignLeadId: true, attemptNo: true },
  })
  if (byCallId) return byCallId

  const claimed = a.metadata?.astrixAttemptId
  if (typeof claimed !== "string" || !claimed) return null

  const byMetadata = await prisma.dialAttempt.findUnique({
    where:  { id: claimed },
    select: { id: true, state: true, campaignId: true, campaignLeadId: true, attemptNo: true },
  })
  if (!byMetadata) return null

  // Learn the id we missed, so every later message about this call resolves the
  // fast way. updateMany rather than update: if two messages race here, the
  // unique index on providerCallId rejects the loser and we would rather it
  // wrote nothing than threw inside a webhook.
  await prisma.dialAttempt.updateMany({
    where: { id: byMetadata.id, providerCallId: null },
    data:  { providerCallId: a.providerCallId },
  })

  return byMetadata
}

/**
 * The call is up. Swap the connect lease for a talk lease.
 *
 * Without this, a conversation longer than ninety seconds looks abandoned and
 * the reaper starts asking the provider about a call that is going perfectly
 * well. Cheap, and it happens on every single call.
 */
export async function markAttemptConnected(a: {
  providerCallId: string
  metadata?: Record<string, unknown> | null
  agentMaxDurationSeconds?: number
}): Promise<void> {
  const attempt = await findAttempt(a)
  if (!attempt || (TERMINAL_ATTEMPT as readonly string[]).includes(attempt.state)) return

  const lease = new Date(
    Date.now() + ((a.agentMaxDurationSeconds ?? 600) + TALK_LEASE_MARGIN_SECONDS) * 1000
  )

  await prisma.$transaction([
    prisma.dialAttempt.updateMany({
      where: { id: attempt.id, state: { notIn: [...TERMINAL_ATTEMPT] } },
      data:  { state: "IN_PROGRESS", leaseExpiresAt: lease },
    }),
    prisma.campaignLead.updateMany({
      where: { id: attempt.campaignLeadId, state: { in: ["DIALING", "IN_PROGRESS"] } },
      data:  { state: "IN_PROGRESS", leaseExpiresAt: lease },
    }),
  ])
}

export type Released = { campaignId: string; leadId: string; outcome: string }

/**
 * The call ended. Close the attempt, move the lead, free the slot.
 *
 * Returns null when the call was nothing to do with a campaign — a test call, or
 * anything inbound. Attribution is exclusively through the attempt ledger, never
 * through the assistant or the phone number, both of which are shared.
 *
 * Idempotent by construction: every write is guarded on the row not already
 * being terminal, so the reaper and a replayed webhook can both run this and the
 * second one changes nothing.
 */
export async function releaseAttempt(a: {
  providerCallId: string
  endedReason: string | null
  durationSeconds: number
  metadata?: Record<string, unknown> | null
}): Promise<Released | null> {
  const attempt = await findAttempt(a)
  if (!attempt) return null
  if ((TERMINAL_ATTEMPT as readonly string[]).includes(attempt.state)) {
    // Already resolved — by the reaper, or by an earlier delivery of this same
    // event. Still worth pumping the campaign, but nothing to write.
    return { campaignId: attempt.campaignId, leadId: attempt.campaignLeadId, outcome: "already-closed" }
  }

  const [lead, campaign] = await Promise.all([
    prisma.campaignLead.findUnique({
      where:  { id: attempt.campaignLeadId },
      select: {
        id: true, tenantId: true, phoneE164: true,
        attemptNo: true, faultNo: true, state: true,
      },
    }),
    prisma.campaign.findUnique({
      where:  { id: attempt.campaignId },
      select: {
        maxAttempts: true, voicemailPolicy: true,
        timezone: true, windowStart: true, windowEnd: true, windowDays: true,
      },
    }),
  ])
  if (!lead || !campaign) return null

  const outcome = classifyOutcome({
    endedReason: a.endedReason,
    durationSeconds: a.durationSeconds,
  })

  const now = new Date()
  const next = scheduleNext({
    outcome,
    attemptNo: lead.attemptNo,
    faultNo: lead.faultNo,
    maxAttempts: campaign.maxAttempts,
    voicemailPolicy: campaign.voicemailPolicy as "LEAVE_MESSAGE" | "HANG_UP_RETRY" | "HANG_UP_DONE",
    now,
  })

  /*
   * A retry that lands outside the calling window is DEFERRED, not RETRY_WAIT.
   *
   * The claim would refuse it anyway, but a deferred lead carries the time the
   * window next opens, so the campaign page can say when it will move rather
   * than showing a queue that looks stuck.
   */
  let state = next.state
  let nextAttemptAt = next.nextAttemptAt

  if (state === "RETRY_WAIT" && nextAttemptAt) {
    const window = {
      timezone: campaign.timezone,
      start: campaign.windowStart,
      end: campaign.windowEnd,
      days: campaign.windowDays,
    }
    if (!withinWindow(window, nextAttemptAt)) {
      state = "DEFERRED"
      nextAttemptAt = nextWindowOpen(window, nextAttemptAt) ?? nextAttemptAt
    }
  }

  await prisma.$transaction([
    prisma.dialAttempt.updateMany({
      where: { id: attempt.id, state: { notIn: [...TERMINAL_ATTEMPT] } },
      data: {
        state: "ENDED",
        endedReason: a.endedReason,
        durationSeconds: Math.max(0, Math.round(a.durationSeconds)),
      },
    }),
    prisma.campaignLead.updateMany({
      // Guarded on the lead still being ours. If a person paused and reset the
      // campaign while this call was live, we do not drag the lead backwards.
      where: { id: lead.id, state: { in: ["DIALING", "IN_PROGRESS"] } },
      data: {
        state,
        nextAttemptAt: nextAttemptAt ?? now,
        leaseExpiresAt: null,
        lastOutcome: outcome,
        note: next.note,
        ...(next.consumesAttempt ? {} : { attemptNo: { decrement: 1 } }),
        ...(outcome === "PROVIDER_ERROR" ? { faultNo: { increment: 1 } } : {}),
      },
    }),
  ])

  /*
   * A call the carrier or the person actively refused means this number should
   * not be dialled again — by this campaign or any other the tenant runs. The
   * lead state alone would only stop the one campaign, and a person who has
   * said no does not want to hear from the next list either.
   *
   * Written outside the transaction on purpose: a duplicate here is harmless,
   * and it must not be able to roll back the outcome that has already been
   * recorded.
   */
  if (outcome === "REJECTED") {
    await prisma.suppression.upsert({
      where:  { tenantId_phoneE164: { tenantId: lead.tenantId, phoneE164: lead.phoneE164 } },
      create: {
        tenantId: lead.tenantId,
        phoneE164: lead.phoneE164,
        source: "CALLER_REQUEST",
        note: "Added automatically — a call to this number was refused.",
      },
      update: {},
    })
  }

  return { campaignId: attempt.campaignId, leadId: lead.id, outcome }
}

/**
 * Start whatever the freed slot allows.
 *
 * Safe to call from anywhere, at any time, concurrently with itself: the claim
 * is the only thing that takes work, and it is atomic. Two advances racing
 * produce one that dials and one that finds no headroom — never a lead called
 * twice.
 */
export async function advanceCampaign(
  campaignId: string,
  opts: { deadline?: number; maxDials?: number } = {}
): Promise<{ dialed: number; drained: boolean }> {
  const ctx = await loadCampaignContext(campaignId)
  if (!ctx) return { dialed: 0, drained: false }

  const ceiling = Math.min(opts.maxDials ?? BATCH_CEILING, BATCH_CEILING)

  const claimed = await claimDueLeads({
    tenantId: ctx.dial.tenantId,
    campaignId,
    tenantMaxConcurrent: ctx.tenantMaxConcurrent,
    platformMaxConcurrent: ctx.platformMaxConcurrent,
    batchCeiling: ceiling,
    connectLeaseSeconds: 90,
  })

  if (!claimed.length) {
    /*
     * Nothing claimed is NOT the same as nothing left.
     *
     * SKIP LOCKED returns short whenever another tick holds the rows, and the
     * headroom is zero whenever the campaign is at its cap — which is most of
     * the time on a healthy campaign. Completion is asked separately.
     */
    const drained = await campaignIsDrained(campaignId)
    if (drained) {
      await prisma.campaign.updateMany({
        where: { id: campaignId, state: "RUNNING" },
        data:  { state: "COMPLETED", completedAt: new Date() },
      })
    }
    return { dialed: 0, drained }
  }

  let dialed = 0
  const abandoned: string[] = []
  const queue = [...claimed]

  const worker = async () => {
    for (;;) {
      const lead = queue.shift()
      if (!lead) return

      // Checked before every dial, not once per batch: the deadline is what
      // stops a tick being killed while holding claimed work.
      if (opts.deadline && Date.now() > opts.deadline) {
        abandoned.push(lead.leadId, ...queue.splice(0).map(l => l.leadId))
        return
      }

      const result = await placeCall(ctx.dial, lead)
      const now = new Date()

      switch (result.kind) {
        case "placed":
          dialed++
          break

        case "duplicate":
          // Another campaign has them on the phone right now. Come back shortly;
          // the attempt is handed back because none was made.
          await prisma.campaignLead.updateMany({
            where: { id: lead.leadId, state: "DIALING" },
            data: {
              state: "RETRY_WAIT",
              attemptNo: { decrement: 1 },
              nextAttemptAt: new Date(now.getTime() + 2 * 60_000),
              leaseExpiresAt: null,
              note: "Already on a call with this person — will try again shortly.",
            },
          })
          break

        case "suppressed":
          await prisma.campaignLead.updateMany({
            where: { id: lead.leadId, state: "DIALING" },
            data: {
              state: "SUPPRESSED", attemptNo: { decrement: 1 }, leaseExpiresAt: null,
              note: "On your do-not-call list.",
            },
          })
          break

        case "contact_capped":
          await prisma.campaignLead.updateMany({
            where: { id: lead.leadId, state: "DIALING" },
            data: {
              state: "RETRY_WAIT", attemptNo: { decrement: 1 },
              nextAttemptAt: new Date(now.getTime() + 6 * 60 * 60_000),
              leaseExpiresAt: null,
              note: "Reached the daily limit for calls to this person.",
            },
          })
          break

        case "no_number":
          // The campaign cannot dial anybody, so stop it rather than churning
          // through the whole list marking leads as failures.
          abandoned.push(lead.leadId, ...queue.splice(0).map(l => l.leadId))
          await prisma.campaign.updateMany({
            where: { id: campaignId, state: "RUNNING" },
            data: {
              state: "PAUSED",
              pausedReason: "No phone number is available for this campaign right now.",
            },
          })
          return

        case "rejected":
          await prisma.campaignLead.updateMany({
            where: { id: lead.leadId, state: "DIALING" },
            data: {
              state: "FAILED", leaseExpiresAt: null,
              note: "We couldn't place a call to this number.",
            },
          })
          break

        case "throttled":
          abandoned.push(lead.leadId, ...queue.splice(0).map(l => l.leadId))
          await prisma.campaign.update({
            where: { id: campaignId },
            data:  { throttledUntil: new Date(now.getTime() + result.retryAfterMs) },
          })
          return

        case "lost":
          // The lead stays DIALING with its lease running. Only the reaper, and
          // only after asking the provider, decides what happened.
          dialed++
          break
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DIAL_CONCURRENCY, claimed.length) }, worker)
  )

  if (abandoned.length) await releaseClaimed(abandoned)

  return { dialed, drained: false }
}
