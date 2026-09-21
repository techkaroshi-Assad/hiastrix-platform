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
        tenant: { select: { id: true, maxConcurrentCalls: true, crmLocationId: true } },
        agent:  { select: { id: true, vapiAssistantId: true, config: true, systemPrompt: true, model: true } },
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
    /*
     * `providerError: null` is the important half of this filter.
     *
     * A number whose id no longer resolves at the provider refuses every
     * dial instantly, and because refused attempts are excluded from the
     * daily count (so a failure cannot burn the cap) it stays permanently
     * the least-used number — which made `pickNumber` prefer it over a
     * healthy one, forever. One dead number took a tenant's whole campaign
     * down for two hours at three rejections a minute while their working
     * number sat untouched. Flagged numbers are simply not eligible; the
     * flag is cleared by a successful re-sync.
     */
    where:  {
      agentId:  campaign.agentId,
      tenantId: campaign.tenantId,
      status:   "ACTIVE",
      providerError: null,
    },
    select: { id: true, vapiPhoneNumberId: true, phoneNumber: true, dailyCallCap: true },
  })

  const WINDOW_MS = 24 * 60 * 60 * 1000
  const since = new Date(Date.now() - WINDOW_MS)

  /*
   * What counts against a number's daily volume.
   *
   * The cap exists because carriers spam-label a caller ID that dials all
   * day — so it should count calls the carrier saw. An attempt the provider
   * refused before it rang (`astrix-rejected`, or any `call.start.error-*`
   * such as the account-wide daily limit on free numbers) never reached a
   * carrier, and counting it is how a number "used up" its 200 calls in an
   * afternoon of failures without a single phone ringing, and then paused
   * the campaign for a day.
   */
  const used = numbers.length
    ? await prisma.dialAttempt.groupBy({
        by:    ["phoneNumberId"],
        where: {
          phoneNumberId: { in: numbers.map(n => n.id) },
          createdAt: { gte: since },
          NOT: [
            { endedReason: "astrix-rejected" },
            { endedReason: { startsWith: "call.start.error" } },
          ],
        },
        _count: { _all: true },
        _min:   { createdAt: true },
      })
    : []

  const usedBy = new Map<string, { count: number; oldest: Date | null }>(
    (used as { phoneNumberId: string | null; _count: { _all: number }; _min: { createdAt: Date | null } }[])
      .filter(u => u.phoneNumberId)
      .map(u => [u.phoneNumberId as string, { count: u._count._all, oldest: u._min.createdAt }])
  )

  const platformCap = settings?.numberDailyCallCap ?? 200

  const callerNumbers: CallerNumber[] = numbers.map(n => {
    const u = usedBy.get(n.id)
    return {
      id: n.id,
      vapiPhoneNumberId: n.vapiPhoneNumberId,
      phoneNumber: n.phoneNumber,
      dialsToday: u?.count ?? 0,
      // The number's own cap wins; null inherits the platform default.
      dailyCap: n.dailyCallCap ?? platformCap,
      capFreesAt: u?.oldest ? new Date(u.oldest.getTime() + WINDOW_MS) : null,
    }
  })

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
      numberDailyCap: platformCap,
      contactDailyCap: settings?.contactDailyCap ?? 2,
      campaignName:   campaign.name,
      /** Null when the tenant has no CRM connected — the pre-dial lookup is
       *  simply skipped, same as everywhere else that reads this. */
      crmLocationId:  campaign.tenant.crmLocationId,

      agentSystemPrompt: campaign.agent.systemPrompt,
      agentConfig:       campaign.agent.config,
      /*
       * The agent's own model, carried purely so the override can name it.
       *
       * The provider validates `assistantOverrides.model` as a whole model
       * object and rejects it outright without a `provider`. We were sending
       * only `messages`, so every outbound call came back 400 and not one was
       * ever placed. Repeating the agent's existing model changes nothing about
       * how it behaves; it just makes the override legal.
       */
      agentModel:        campaign.agent.model,
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
