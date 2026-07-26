import { prisma } from "@/lib/prisma"
import { vapiAssistants } from "@/lib/vapi/client"
import {
  sendLowBalance,
  sendCallsPaused,
  billingRecipients,
} from "@/lib/email"

/**
 * Called on every call.ended webhook from Vapi.
 * Calculates cost, deducts from tenant balance, enforces cap.
 */
export async function processCallEnded(params: {
  tenantId: string
  callId: string
  durationSeconds: number
}) {
  const { tenantId, callId, durationSeconds } = params

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { package: true },
  })

  const minutesBilled = Math.ceil(durationSeconds / 60)

  // No package means no allowance and no rate to charge against. Record the
  // usage so the call is still visible and billable later, but do not guess
  // at a price.
  if (!tenant.package) {
    console.warn(`Tenant ${tenantId} has no package assigned`)
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: tenantId },
        data:  { minutesUsed: { increment: minutesBilled } },
      }),
      prisma.call.update({
        where: { id: callId },
        data:  { minutesBilled, costCents: 0, status: "COMPLETED" },
      }),
    ])
    return
  }

  const newMinutesUsed = tenant.minutesUsed + minutesBilled
  const packageCap = tenant.package.minutesIncluded

  let costCents = 0
  let ledgerType: "CALL_DEDUCTION" | "OVERAGE_CHARGE" = "CALL_DEDUCTION"

  if (newMinutesUsed > packageCap) {
    // Some or all of this call is overage
    const previousOverageMinutes = Math.max(0, tenant.minutesUsed - packageCap)
    const totalOverageMinutes = newMinutesUsed - packageCap
    const newOverageMinutes = totalOverageMinutes - previousOverageMinutes

    costCents = newOverageMinutes * tenant.package.overageRateCents
    ledgerType = "OVERAGE_CHARGE"
  }

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
    prisma.call.update({
      where: { id: callId },
      data: {
        minutesBilled,
        costCents,
        status: "COMPLETED",
      },
    }),
    // Only recorded when the call actually incurred a charge.
    ...(costCents > 0
      ? [
          prisma.creditLedger.create({
            data: {
              tenantId,
              type: ledgerType,
              amountCents: -costCents,
              description: `Call charge — ${minutesBilled} overage min @ $${(tenant.package.overageRateCents / 100).toFixed(2)}/min`,
              referenceId: callId,
            },
          }),
        ]
      : []),
  ])

  // Check if balance is now zero or below — block all agents
  const updatedTenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { agents: true },
  })

  if (costCents === 0) return

  const recipients = await billingRecipients(prisma, tenantId)

  if (updatedTenant.creditBalanceCents <= 0) {
    await disableAllTenantAgents(tenantId, updatedTenant.agents)
    if (recipients.length) {
      await sendCallsPaused({ to: recipients, companyName: updatedTenant.companyName })
    }
    return
  }

  // Warn once per crossing of the low-balance threshold, not on every call.
  const settings = await prisma.platformSettings.findUnique({ where: { id: true } })
  const pct = settings?.lowBalancePct ?? 20
  const threshold = Math.round((tenant.package.priceCents * pct) / 100)

  const before = updatedTenant.creditBalanceCents + costCents
  const crossed = before > threshold && updatedTenant.creditBalanceCents <= threshold

  if (crossed && threshold > 0 && recipients.length) {
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
