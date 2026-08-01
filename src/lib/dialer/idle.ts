/**
 * Why a running campaign is not calling anybody this minute — SERVER ONLY.
 *
 * `campaignReadiness` answers "may this start?", which is asked once when
 * somebody presses the button. This answers a different and more frequently
 * asked question: it is running, it says RUNNING, and nothing is happening —
 * what is it waiting for?
 *
 * The gap between those two mattered. A campaign with sixty-eight people
 * loaded, an active agent, a phone number and a healthy balance sat showing
 * "0 spoke to" and "0 on the phone now" while the dialer refused it every
 * minute, entirely correctly, because the local time was 21:31 and the calling
 * window closed at 19:00. Nothing on the page said so. The engine was right and
 * looked broken, which is the worst combination — it invites someone to go and
 * "fix" a thing that is working.
 *
 * Every answer here names the setting the tenant can go and change, and where
 * the wait is a matter of time rather than configuration, says when.
 */

import { prisma } from "@/lib/prisma"
import { verdictFor } from "@/lib/billing/can-call"
import { withinWindow, nextWindowOpen } from "@/lib/dialer/outcome"

export type IdleReason = {
  /** Short label for a pill. */
  label: string
  /** A sentence a tenant can act on. */
  detail: string
  /** True when this is simply how it should be — waiting, not broken. */
  normal: boolean
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function whenPhrase(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at)
}

/**
 * Null when the campaign is genuinely working — dialling, or at its cap.
 *
 * Deliberately ordered by what stops the campaign hardest: a platform switch
 * beats an unpaid balance beats a detached number beats the clock. Reporting
 * the clock to somebody whose agent is switched off would send them to the
 * wrong screen.
 */
export async function whyIdle(campaignId: string): Promise<IdleReason | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      tenant: {
        include: { package: { select: { minutesIncluded: true, overageRateCents: true } } },
      },
      agent: { select: { name: true, status: true } },
    },
  })
  if (!campaign) return null

  if (campaign.state === "PAUSED") {
    return {
      label: "Paused",
      detail: campaign.pausedReason ?? "This campaign is paused. Press Resume when you're ready.",
      normal: true,
    }
  }
  if (campaign.state !== "RUNNING") return null

  /* ── The platform switch ───────────────────────────────────────────── */

  const settings = await prisma.platformSettings.findFirst({ where: { id: true } })
  if (settings?.dialerEnabled === false) {
    return {
      label: "Paused by Hi-Astrix",
      detail: "Outbound calling is paused across the platform while we look at something. Your list is untouched and will carry on where it stopped.",
      normal: false,
    }
  }

  /* ── Money ─────────────────────────────────────────────────────────── */

  const verdict = verdictFor({
    status:             campaign.tenant.status,
    minutesUsed:        campaign.tenant.minutesUsed,
    creditBalanceCents: campaign.tenant.creditBalanceCents,
    package:            campaign.tenant.package,
  }, settings?.overageRateCents ?? 35)

  if (!verdict.ok) {
    return {
      label: "No balance",
      detail: verdict.allowance.stoppedReason
        ?? "Add credit or choose a plan, and this will pick up where it left off.",
      normal: false,
    }
  }

  /* ── The agent and its numbers ─────────────────────────────────────── */

  if (campaign.agent.status !== "ACTIVE") {
    return {
      label: "Agent off",
      detail: `${campaign.agent.name} is switched off, so nothing can be dialled. Turn it back on from the Agents page.`,
      normal: false,
    }
  }

  const numbers = await prisma.phoneNumber.count({
    where: { agentId: campaign.agentId, tenantId: campaign.tenantId, status: "ACTIVE" },
  })
  if (!numbers) {
    return {
      label: "No number",
      detail: `${campaign.agent.name} has no phone number attached, and an outbound call needs one to show as the caller.`,
      normal: false,
    }
  }

  /* ── Backed off after provider trouble ─────────────────────────────── */

  if (campaign.throttledUntil && campaign.throttledUntil.getTime() > Date.now()) {
    return {
      label: "Slowing down",
      detail: `Calls are being spaced out after some didn't connect. Normal service resumes at ${whenPhrase(campaign.throttledUntil, campaign.timezone)}.`,
      normal: true,
    }
  }

  /* ── The clock ─────────────────────────────────────────────────────── */

  const window = {
    timezone: campaign.timezone,
    start:    campaign.windowStart,
    end:      campaign.windowEnd,
    days:     campaign.windowDays,
  }

  if (!withinWindow(window, new Date())) {
    const opens = nextWindowOpen(window, new Date())
    const days  = campaign.windowDays.map((d: number) => DAY_NAMES[d - 1]).join(", ")
    return {
      label: "Outside calling hours",
      detail: opens
        ? `This campaign only calls between ${campaign.windowStart} and ${campaign.windowEnd} ${campaign.timezone.replace(/_/g, " ")}, on ${days}. It starts again ${whenPhrase(opens, campaign.timezone)}.`
        : `This campaign has no day it is allowed to call on. Edit its settings and choose at least one.`,
      normal: true,
    }
  }

  /* ── Inside the window, so is there anybody due? ───────────────────── */

  const [live, dueNow, waitingLater] = await Promise.all([
    prisma.campaignLead.count({
      where: { campaignId, state: { in: ["DIALING", "IN_PROGRESS"] } },
    }),
    prisma.campaignLead.count({
      where: {
        campaignId,
        state: { in: ["PENDING", "RETRY_WAIT"] },
        nextAttemptAt: { lte: new Date() },
      },
    }),
    prisma.campaignLead.findFirst({
      where:   { campaignId, state: { in: ["PENDING", "RETRY_WAIT", "DEFERRED"] } },
      orderBy: { nextAttemptAt: "asc" },
      select:  { nextAttemptAt: true },
    }),
  ])

  // Actually working. Either people are on the phone, or somebody is due and
  // the next tick will take them.
  if (live > 0 || dueNow > 0) return null

  if (waitingLater?.nextAttemptAt) {
    return {
      label: "Waiting to try again",
      detail: `Everybody left has been tried and is waiting before the next attempt. The next one is due ${whenPhrase(waitingLater.nextAttemptAt, campaign.timezone)}.`,
      normal: true,
    }
  }

  return {
    label: "Nobody left",
    detail: "Everyone on this list has been worked through. Add more people, or archive it.",
    normal: true,
  }
}
