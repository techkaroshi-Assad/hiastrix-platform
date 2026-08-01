/**
 * Everything one campaign needs to place a call, loaded once per tick rather
 * than once per lead — SERVER ONLY.
 *
 * A batch of eight dials would otherwise be eight identical reads of the
 * campaign, the agent, the numbers and the platform settings. On a pool capped
 * at five connections, shared with the webhook, that is the difference between a
 * tick that finishes and one that queues behind itself.
 */

import { prisma } from "@/lib/prisma"
import type { DialContext, CallerNumber } from "@/lib/dialer/dial"
import type { VoicemailPolicy, Window } from "@/lib/dialer/outcome"

export type CampaignContext = {
  dial: DialContext
  agentId: string
  maxAttempts: number
  voicemailPolicy: VoicemailPolicy
  window: Window
  /** Whichever is lower: the tenant's own cap or the platform default. */
  tenantMaxConcurrent: number
  platformMaxConcurrent: number
  /** Agent's own call length, which sizes the talk lease. */
  agentMaxDurationSeconds: number
}

/** Vapi's own default, and the default in lib/vapi/config.ts. */
const DEFAULT_CALL_SECONDS = 600

export async function loadCampaignContext(campaignId: string): Promise<CampaignContext | null> {
  const [campaign, settings] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        tenant: { select: { id: true, maxConcurrentCalls: true } },
        agent:  { select: { id: true, vapiAssistantId: true, config: true, systemPrompt: true } },
      },
    }),
    prisma.platformSettings.findFirst({ where: { id: true } }),
  ])

  if (!campaign) return null

  /*
   * Caller IDs.
   *
   * Every ACTIVE number attached to the agent, with how many calls it has
   * placed in the last day. A campaign may pin one, but the default is to
   * rotate: a single number dialling all day gets spam-labelled by carriers,
   * and a spam-labelled number does not get answered.
   */
  const numbers = await prisma.phoneNumber.findMany({
    where:  { agentId: campaign.agentId, tenantId: campaign.tenantId, status: "ACTIVE" },
    select: { id: true, vapiPhoneNumberId: true, phoneNumber: true },
  })

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const used = numbers.length
    ? await prisma.dialAttempt.groupBy({
        by:    ["phoneNumberId"],
        where: { phoneNumberId: { in: numbers.map(n => n.id) }, createdAt: { gte: since } },
        _count: { _all: true },
      })
    : []

  const usedBy = new Map<string, number>(
    (used as { phoneNumberId: string | null; _count: { _all: number } }[])
      .filter(u => u.phoneNumberId)
      .map(u => [u.phoneNumberId as string, u._count._all])
  )

  const callerNumbers: CallerNumber[] = numbers.map(n => ({
    id: n.id,
    vapiPhoneNumberId: n.vapiPhoneNumberId,
    phoneNumber: n.phoneNumber,
    dialsToday: usedBy.get(n.id) ?? 0,
  }))

  const platformMax = settings?.maxConcurrentCalls ?? 40
  const tenantDefault = settings?.tenantMaxConcurrent ?? 10

  // A tenant override may only ever lower the platform ceiling.
  const tenantMax = Math.min(
    campaign.tenant.maxConcurrentCalls ?? tenantDefault,
    platformMax
  )

  const cfg = (campaign.agent.config ?? {}) as { maxDurationSeconds?: unknown }
  const agentMaxDurationSeconds =
    typeof cfg.maxDurationSeconds === "number" && cfg.maxDurationSeconds > 0
      ? cfg.maxDurationSeconds
      : DEFAULT_CALL_SECONDS

  return {
    dial: {
      campaignId:     campaign.id,
      tenantId:       campaign.tenantId,
      vapiAssistantId: campaign.agent.vapiAssistantId,
      pinnedNumberId: campaign.phoneNumberId,
      numbers:        callerNumbers,
      numberDailyCap: settings?.numberDailyCallCap ?? 200,
      contactDailyCap: settings?.contactDailyCap ?? 2,
      campaignName:   campaign.name,

      agentSystemPrompt: campaign.agent.systemPrompt,
      agentConfig:       campaign.agent.config,
      // Falls back to a sentence rather than an empty string: a platform_settings
      // row that predates this column must not silently produce campaign calls
      // with no consent line at all.
      consentLine: settings?.consentLine
        ?? "Let the person know this call may be recorded, in your first sentence, before anything else.",
      voicemailMessage: campaign.voicemailPolicy === "LEAVE_MESSAGE"
        ? campaign.voicemailMessage
        : null,
    },
    agentId:            campaign.agentId,
    maxAttempts:        campaign.maxAttempts,
    voicemailPolicy:    campaign.voicemailPolicy as VoicemailPolicy,
    window: {
      timezone: campaign.timezone,
      start:    campaign.windowStart,
      end:      campaign.windowEnd,
      days:     campaign.windowDays,
    },
    tenantMaxConcurrent:  tenantMax,
    platformMaxConcurrent: platformMax,
    agentMaxDurationSeconds,
  }
}
