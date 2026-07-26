import { prisma } from "@/lib/prisma"
import { vapiAssistants } from "@/lib/vapi/client"

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

  if (!tenant.package) {
    console.warn(`Tenant ${tenantId} has no package assigned`)
    return
  }

  const minutesBilled = Math.ceil(durationSeconds / 60)
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

  // Update tenant balance and usage in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        minutesUsed: newMinutesUsed,
        creditBalanceCents: { decrement: costCents },
      },
    })

    await tx.call.update({
      where: { id: callId },
      data: {
        minutesBilled,
        costCents,
        status: "COMPLETED",
      },
    })

    if (costCents > 0) {
      await tx.creditLedger.create({
        data: {
          tenantId,
          type: ledgerType,
          amountCents: -costCents,
          description: `Call deduction — ${minutesBilled} overage min @ $${(tenant.package!.overageRateCents / 100).toFixed(2)}/min`,
          referenceId: callId,
        },
      })
    }
  })

  // Check if balance is now zero or below — block all agents
  const updatedTenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { agents: true },
  })

  if (updatedTenant.creditBalanceCents <= 0 && costCents > 0) {
    await disableAllTenantAgents(tenantId, updatedTenant.agents)
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

  // TODO: send email to tenant and account manager
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
