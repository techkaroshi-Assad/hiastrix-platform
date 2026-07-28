import { after } from "next/server"
import { prisma } from "@/lib/prisma"
import { applyAgentAvailability } from "@/lib/agents/availability"
import { verdictFor } from "@/lib/billing/can-call"
import {
  sendLowBalance,
  sendCallsPaused,
  billingRecipients,
} from "@/lib/email"

/** Fallback when no platform_settings row exists yet. */
const FALLBACK_RATE_CENTS = 35

/**
 * Send after the response, not before it.
 *
 * Both notices below used to be awaited on the call-lifecycle webhook's critical
 * path. With one call at a time that was merely slow; with a dialer running,
 * dozens of end-of-call reports land per minute and every one of them waits on
 * the email provider. A slow webhook makes the voice provider retry, which
 * doubles the load that made it slow.
 *
 * The money above stays inline. Only the telling-them-about-it moves.
 *
 * Falls back to sending inline outside a request context, so this is still safe
 * if it is ever called from a background job.
 */
function later(work: () => Promise<unknown>): void {
  try {
    after(async () => {
      try { await work() } catch (err) { console.error("[billing/notify]", err) }
    })
  } catch {
    void work().catch(err => console.error("[billing/notify]", err))
  }
}

/**
 * Called on every call.ended webhook from Vapi.
 *
 * Two billing shapes, one code path:
 *
 *   With a package — minutes inside the allowance are free; only minutes
 *   beyond the cap are charged, at the package's own rate.
 *
 *   Without a package — there is no allowance, so every minute is charged at
 *   the platform default rate. This is the credit-funded case: a tenant who
 *   has been granted balance for trials or testing still gets billed for what
 *   they use, rather than calling for free until someone assigns a tier.
 */
export async function processCallEnded(params: {
  tenantId: string
  callId: string
  durationSeconds: number
}) {
  const { tenantId, callId, durationSeconds } = params

  const [tenant, settings] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { package: true },
    }),
    prisma.platformSettings.findUnique({ where: { id: true } }),
  ])

  const minutesBilled  = Math.ceil(durationSeconds / 60)
  const newMinutesUsed = tenant.minutesUsed + minutesBilled

  const cap  = tenant.package?.minutesIncluded ?? 0
  const rate = tenant.package?.overageRateCents
    ?? settings?.overageRateCents
    ?? FALLBACK_RATE_CENTS

  // How many of this call's minutes are actually chargeable.
  let chargeableMinutes: number
  let ledgerType: "CALL_DEDUCTION" | "OVERAGE_CHARGE"

  if (cap > 0) {
    // Only the portion that pushes past the cap costs anything, and only the
    // part not already counted as overage on earlier calls.
    const previousOverage = Math.max(0, tenant.minutesUsed - cap)
    const totalOverage    = Math.max(0, newMinutesUsed - cap)
    chargeableMinutes     = totalOverage - previousOverage
    ledgerType            = "OVERAGE_CHARGE"
  } else {
    chargeableMinutes = minutesBilled
    ledgerType        = "CALL_DEDUCTION"
  }

  const costCents = chargeableMinutes * rate

  // Batch transaction (array form), not an interactive one.
  //
  // The array form ships every statement in a single round trip on one pooled
  // connection, so it stays atomic while remaining compatible with Supabase's
  // transaction-mode pooler. An interactive `$transaction(async tx => …)`
  // holds a connection open across round trips, which transaction-mode
  // pooling cannot support.
  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        minutesUsed: newMinutesUsed,
        creditBalanceCents: { decrement: costCents },
      },
    }),
    // Deliberately does NOT touch `status`.
    //
    // The webhook already derived FAILED / NO_ANSWER / BUSY from the provider's
    // endedReason before calling us. Overwriting that with COMPLETED here
    // relabelled every call that ran for more than zero seconds, which made the
    // outcome breakdown read as ~100% completed. Billing owns the money
    // columns; the webhook owns the outcome.
    prisma.call.update({
      where: { id: callId },
      data: { minutesBilled, costCents },
    }),
    // Only recorded when the call actually incurred a charge.
    ...(costCents > 0
      ? [
          prisma.creditLedger.create({
            data: {
              tenantId,
              type: ledgerType,
              amountCents: -costCents,
              description:
                cap > 0
                  ? `Call charge — ${chargeableMinutes} overage min @ $${(rate / 100).toFixed(2)}/min`
                  : `Call charge — ${chargeableMinutes} min @ $${(rate / 100).toFixed(2)}/min`,
              referenceId: callId,
            },
          }),
        ]
      : []),
  ])

  if (costCents === 0) return

  const updatedTenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { agents: true },
  })

  const recipients = await billingRecipients(tenantId)

  /*
   * Out of credit — stop answering and say so.
   *
   * This used to read `creditBalanceCents <= 0`, which is not the same question.
   * A tenant who has just bought a plan sits at a full allowance and zero
   * credit, and metering never charges them until they exceed it — so that test
   * took paying customers off the air the moment their first call landed.
   * `verdictFor` is the one place that question is answered.
   */
  const verdict = verdictFor({
    status:             updatedTenant.status,
    minutesUsed:        updatedTenant.minutesUsed,
    creditBalanceCents: updatedTenant.creditBalanceCents,
    package:            tenant.package,
  }, rate)

  if (!verdict.ok) {
    // Taking them off the air stays inline — that one is not a notification,
    // it is the thing that stops the spending.
    await disableAllTenantAgents(tenantId, updatedTenant.agents)
    await pauseTenantCampaigns(tenantId)
    if (recipients.length) {
      later(() => sendCallsPaused({ to: recipients, companyName: updatedTenant.companyName }))
    }
    return
  }

  // Warn once, on the call that crosses the threshold — not on every call after.
  const pct = settings?.lowBalancePct ?? 20
  const threshold = tenant.package
    ? Math.round((tenant.package.priceCents * pct) / 100)
    : 0

  const balanceBefore = updatedTenant.creditBalanceCents + costCents
  const crossed =
    threshold > 0 &&
    balanceBefore > threshold &&
    updatedTenant.creditBalanceCents <= threshold

  if (crossed && recipients.length) {
    later(() => sendLowBalance({
      to: recipients,
      companyName: updatedTenant.companyName,
      balanceCents: updatedTenant.creditBalanceCents,
    }))
  }
}

/**
 * Stop a tenant's campaigns when the money runs out — pause, never cancel.
 *
 * The queue is left exactly as it is: every lead keeps its state, its attempt
 * count and its next-attempt time. Topping up resumes from precisely where it
 * stopped rather than starting a list again from the beginning, which would
 * re-call everybody who had already been reached.
 *
 * `pausedReason` is what the campaign page shows, so a tenant is told why their
 * campaign stopped rather than finding it mysteriously idle.
 *
 * Deliberately separate from `disableAllTenantAgents`, which flips every agent's
 * status: a Stripe top-up turns all of those back on, so agent status cannot be
 * allowed to carry a campaign's intent.
 */
export async function pauseTenantCampaigns(tenantId: string): Promise<number> {
  const res = await prisma.campaign.updateMany({
    where: { tenantId, state: "RUNNING" },
    data: {
      state: "PAUSED",
      pausedReason: "Paused because the balance ran out. Top up and it will carry on where it left off.",
    },
  })
  return res.count
}

/**
 * The other half: bring back only the campaigns we stopped for money.
 *
 * Matched on `pausedReason`, so a campaign someone paused by hand stays paused.
 * Resuming a tenant's own deliberate pause because their card went through would
 * be the platform making outbound calls nobody asked for.
 */
export async function resumeTenantCampaigns(tenantId: string): Promise<number> {
  const res = await prisma.campaign.updateMany({
    where: {
      tenantId,
      state: "PAUSED",
      pausedReason: { startsWith: "Paused because the balance ran out" },
    },
    data: { state: "RUNNING", pausedReason: null },
  })
  return res.count
}

export async function disableAllTenantAgents(
  tenantId: string,
  agents: { id: string; vapiAssistantId: string }[]
) {
  await prisma.agent.updateMany({
    where: { tenantId },
    data: { status: "INACTIVE" },
  })

  // Our record first, then make the provider agree. In that order, a failure
  // upstream leaves an agent we believe is off and can retry, rather than one
  // we believe is on while it quietly keeps answering.
  await applyAgentAvailability(
    agents.map((agent) => ({ ...agent, status: "INACTIVE" as const }))
  )
}

export async function enableAllTenantAgents(
  tenantId: string,
  agents: { id: string; vapiAssistantId: string }[]
) {
  await prisma.agent.updateMany({
    where: { tenantId },
    data: { status: "ACTIVE" },
  })

  await applyAgentAvailability(
    agents.map((agent) => ({ ...agent, status: "ACTIVE" as const }))
  )

  // Campaigns we stopped for money come back too, from exactly where they were.
  // Ones a person paused deliberately do not — see resumeTenantCampaigns.
  await resumeTenantCampaigns(tenantId)
}
