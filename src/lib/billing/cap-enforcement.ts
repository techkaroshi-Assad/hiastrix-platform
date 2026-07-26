import { prisma } from "@/lib/prisma"
import { vapiAssistants } from "@/lib/vapi/client"
import {
  sendLowBalance,
  sendCallsPaused,
  billingRecipients,
} from "@/lib/email"

/** Fallback when no platform_settings row exists yet. */
const FALLBACK_RATE_CENTS = 35

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

  // Out of credit — stop answering and say so.
  if (updatedTenant.creditBalanceCents <= 0) {
    await disableAllTenantAgents(tenantId, updatedTenant.agents)
    if (recipients.length) {
      await sendCallsPaused({ to: recipients, companyName: updatedTenant.companyName })
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
    await sendLowBalance({
      to: recipients,
      companyName: updatedTenant.companyName,
      balanceCents: updatedTenant.creditBalanceCents,
    })
  }
}

export async function disableAllTenantAgents(
  tenantId: string,
  agents: { id: string; vapiAssistantId: string }[]
) {
  await Promise.allSettled(
    agents.map((agent) => vapiAssistants.disable(agent.vapiAssistantId))
  )

  await prisma.agent.updateMany({
    where: { tenantId },
    data: { status: "INACTIVE" },
  })
}

export async function enableAllTenantAgents(
  tenantId: string,
  agents: { id: string; vapiAssistantId: string }[]
) {
  await Promise.allSettled(
    agents.map((agent) => vapiAssistants.enable(agent.vapiAssistantId))
  )

  await prisma.agent.updateMany({
    where: { tenantId },
    data: { status: "ACTIVE" },
  })
}
