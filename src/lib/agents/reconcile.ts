/**
 * Making the provider agree with us about who is allowed to answer the phone.
 *
 * There is no such thing as a disabled assistant at the voice provider. An
 * agent is off because its phone number points at nothing, so "turning an agent
 * off" is a request to somebody else's API — and a request to somebody else's
 * API is a thing that fails. When it fails today the only trace is a line in a
 * log nobody reads, and the consequence is an agent we believe is off that
 * quietly keeps answering calls and spending money.
 *
 * That is not hypothetical. On 31 July a tenant with no plan and a balance of
 * −$1.50, whose agent's stored status was INACTIVE, answered a 196-second
 * inbound call. Outbound, test and web calls all check the balance before they
 * place anything; an inbound call is answered by the provider before we hear
 * about it, so the number *is* the gate, and the gate had not closed.
 *
 * Two different failures produce that, and this file fixes both:
 *
 *   The gate was never asked to close. Whatever should have disabled the agent
 *   did not run — an error on a path that had already half-happened, a
 *   deployment mid-flight, a balance that went negative some other way.
 *
 *   The gate was asked and did not close. The provider call failed and was
 *   logged, or the assignment was changed upstream by hand afterwards.
 *
 * Both are answered by asking the question again, on a schedule, forever.
 * Reconciliation is cheap, idempotent, and the only honest way to hold a fact
 * that lives in someone else's database.
 */

import { prisma } from "@/lib/prisma"
import { verdictFor } from "@/lib/billing/can-call"
import { applyAgentAvailability } from "@/lib/agents/availability"
import {
  disableAllTenantAgents,
  pauseTenantCampaigns,
} from "@/lib/billing/cap-enforcement"

/** Bounded so a sweep can never become the expensive part of a tick. */
const MAX_TENANTS = 25
const MAX_AGENTS  = 25

export type ReconcileResult = {
  /** Tenants who could not pay and still had agents switched on. */
  disabled: number
  /** Agents we believe are off, re-asserted at the provider. */
  reasserted: number
  /** Campaigns stopped alongside a disable. */
  campaignsPaused: number
}

/**
 * Step one: anybody who cannot pay but is still switched on.
 *
 * Pure database work — no provider calls unless something is actually wrong —
 * so this is cheap enough to run on every heartbeat. It is the backstop for the
 * disable never having happened, and it asks the same question `verdictFor`
 * answers everywhere else rather than inventing a second definition of broke.
 */
async function closeGatesForUnpaid(): Promise<{ disabled: number; campaignsPaused: number }> {
  const candidates = await prisma.tenant.findMany({
    where: {
      // A tenant already INACTIVE or BLOCKED has been dealt with by an operator.
      status: "ACTIVE",
      agents: { some: { status: "ACTIVE" } },
    },
    select: {
      id: true,
      status: true,
      minutesUsed: true,
      creditBalanceCents: true,
      package: { select: { minutesIncluded: true, overageRateCents: true } },
      agents: { where: { status: "ACTIVE" }, select: { id: true, vapiAssistantId: true } },
    },
    take: MAX_TENANTS,
  })

  const settings = await prisma.platformSettings.findUnique({ where: { id: true } })
  const fallbackRate = settings?.overageRateCents ?? 35

  let disabled = 0
  let campaignsPaused = 0

  for (const tenant of candidates) {
    const verdict = verdictFor(
      {
        status:             tenant.status,
        minutesUsed:        tenant.minutesUsed,
        creditBalanceCents: tenant.creditBalanceCents,
        package:            tenant.package,
      },
      fallbackRate
    )
    if (verdict.ok) continue

    await disableAllTenantAgents(tenant.id, tenant.agents)
    campaignsPaused += await pauseTenantCampaigns(tenant.id)
    disabled++
  }

  return { disabled, campaignsPaused }
}

/**
 * Step two: agents we believe are off, said again to the provider.
 *
 * Only agents that are INACTIVE *and* hold a number — an agent with no number
 * cannot receive a call whatever the provider thinks, so there is nothing to
 * assert. Assigning null to a number that is already null is a no-op upstream,
 * which is what makes running this repeatedly safe.
 *
 * This is the half that costs provider calls, so callers decide how often it
 * runs. Every minute would be waste; never is how you end up with an agent
 * answering calls for a workspace that stopped paying in March.
 */
async function reassertDisabled(): Promise<number> {
  const agents = await prisma.agent.findMany({
    where:  { status: "INACTIVE", phoneNumbers: { some: {} } },
    select: { id: true, vapiAssistantId: true },
    take:   MAX_AGENTS,
  })
  if (!agents.length) return 0

  await applyAgentAvailability(agents.map(a => ({ ...a, status: "INACTIVE" as const })))
  return agents.length
}

/**
 * @param deep whether to re-assert at the provider as well as check the money.
 */
export async function reconcileAvailability(deep: boolean): Promise<ReconcileResult> {
  const { disabled, campaignsPaused } = await closeGatesForUnpaid()
  const reasserted = deep ? await reassertDisabled() : 0
  return { disabled, reasserted, campaignsPaused }
}
