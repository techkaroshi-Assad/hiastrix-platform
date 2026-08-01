/**
 * May this campaign start? — SERVER ONLY.
 *
 * Asked before a campaign is ever set RUNNING, and asked in one place so the
 * start button and the API agree about what "ready" means.
 *
 * The point of checking here rather than letting the claim silently refuse is
 * that a campaign which cannot run should say so to the person pressing the
 * button, not sit there looking busy and doing nothing. Every message below is
 * written to be read by a tenant and to name the thing they can go and change.
 */

import { prisma } from "@/lib/prisma"
import { verdictFor } from "@/lib/billing/can-call"
import { readConfig } from "@/lib/vapi/config"
import { blockersFor } from "@/lib/agents/prompt-check"

export type Readiness = { ok: true } | { ok: false; reason: string }

export async function campaignReadiness(campaignId: string): Promise<Readiness> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      tenant: {
        include: { package: { select: { minutesIncluded: true, overageRateCents: true } } },
      },
      agent: { select: { id: true, name: true, status: true, config: true, systemPrompt: true, firstMessage: true } },
    },
  })
  if (!campaign) return { ok: false, reason: "That campaign no longer exists." }

  if (campaign.state === "ARCHIVED") {
    return { ok: false, reason: "This campaign has been archived." }
  }

  /* ── Money ─────────────────────────────────────────────────────────── */

  const verdict = verdictFor({
    status:             campaign.tenant.status,
    minutesUsed:        campaign.tenant.minutesUsed,
    creditBalanceCents: campaign.tenant.creditBalanceCents,
    package:            campaign.tenant.package,
  })
  if (!verdict.ok) {
    return {
      ok: false,
      reason: verdict.reason === "suspended"
        ? "Your workspace isn't active, so campaigns can't run."
        : verdict.allowance.stoppedReason
          ?? "Top up your balance before starting a campaign.",
    }
  }

  /* ── The agent ─────────────────────────────────────────────────────── */

  if (campaign.agent.status !== "ACTIVE") {
    return { ok: false, reason: `Turn ${campaign.agent.name} on before starting this campaign.` }
  }

  /*
   * And the agent's setup has to be fit to run.
   *
   * The same gate as switching an agent on, asked again here because a campaign
   * is the other way an agent reaches real people — and a prompt carrying four
   * copies of one section costs four times as much across a list of hundreds as
   * it does on one inbound call.
   */
  const agentConfig = readConfig(campaign.agent.config)
  const blockers = blockersFor({
    systemPrompt: campaign.agent.systemPrompt ?? "",
    firstMessage: campaign.agent.firstMessage ?? "",
    tools:        agentConfig.tools,
    config:       agentConfig,
    usedForOutbound: true,
  })
  if (blockers.length) {
    return {
      ok: false,
      reason: `${campaign.agent.name} can't run a campaign yet — ${blockers[0]!.title.toLowerCase()}. Open the agent and fix that first.`,
    }
  }

  /* ── A number to call from ─────────────────────────────────────────── */

  const numbers = await prisma.phoneNumber.findMany({
    where:  { agentId: campaign.agentId, tenantId: campaign.tenantId, status: "ACTIVE" },
    select: { id: true },
  })

  if (!numbers.length) {
    return {
      ok: false,
      reason: `${campaign.agent.name} has no phone number attached. Outbound calls need one to show as the caller.`,
    }
  }

  if (campaign.phoneNumberId && !numbers.some(n => n.id === campaign.phoneNumberId)) {
    return {
      ok: false,
      reason: "The number this campaign is set to call from is no longer attached to its agent.",
    }
  }

  /* ── Somebody to call ──────────────────────────────────────────────── */

  const waiting = await prisma.campaignLead.count({
    where: { campaignId, state: { in: ["PENDING", "RETRY_WAIT", "DEFERRED"] } },
  })
  if (!waiting) {
    return { ok: false, reason: "There's nobody left to call in this campaign." }
  }

  /* ── Voicemail ─────────────────────────────────────────────────────── */

  /*
   * The one non-obvious check, and the reason it exists:
   *
   * with voicemail detection off, the agent cheerfully talks to an answering
   * machine for forty seconds. That classifies as a real conversation, so the
   * lead is marked as spoken-to and the campaign reports a contact rate that is
   * flattering and wrong. Every policy except "hang up and don't retry" depends
   * on knowing a machine picked up.
   */
  if (campaign.voicemailPolicy !== "HANG_UP_DONE") {
    const config = readConfig(campaign.agent.config)
    if (!config.voicemailDetectionEnabled) {
      return {
        ok: false,
        reason: `Turn on voicemail detection for ${campaign.agent.name}. Without it the agent talks to answering machines and records them as real conversations.`,
      }
    }
    if (campaign.voicemailPolicy === "LEAVE_MESSAGE"
        && !campaign.voicemailMessage?.trim()
        && !config.voicemailMessage.trim()) {
      return {
        ok: false,
        reason: "Write the voicemail message this campaign should leave, or change what it does when a machine answers.",
      }
    }
  }

  /* ── The calling window ────────────────────────────────────────────── */

  if (!campaign.windowDays.length) {
    return { ok: false, reason: "Choose at least one day this campaign is allowed to call on." }
  }
  if (campaign.windowStart >= campaign.windowEnd) {
    return { ok: false, reason: "The calling window has to end after it starts." }
  }

  return { ok: true }
}
