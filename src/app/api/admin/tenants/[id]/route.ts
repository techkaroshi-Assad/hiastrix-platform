/**
 * PATCH /api/admin/tenants/[id]
 *
 * One endpoint covering the operational levers Astrix needs on a tenant:
 * status, package assignment, manual credit adjustment, and which CRM
 * sub-account the tenant's agents act on.
 *
 * A credit adjustment always writes a CreditLedger entry with the operator's
 * note, so the balance is never changed without an audit trail. Crossing zero
 * upward re-enables paused agents; crossing to zero disables them.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { enableAllTenantAgents, disableAllTenantAgents } from "@/lib/billing/cap-enforcement"
import {
  sendCreditGranted,
  sendWorkspaceActivated,
  billingRecipients,
} from "@/lib/email"
import { forgetLocation } from "@/lib/crm/client"
import { readAllowance } from "@/lib/billing/allowance"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  status:    z.enum(["PENDING", "ACTIVE", "INACTIVE", "BLOCKED"]).optional(),
  packageId: z.string().uuid().nullable().optional(),
  /**
   * Which CRM sub-account this tenant's agents read and write. Null unmaps them,
   * which is the safe direction — their agents then decline CRM actions rather
   * than writing into whatever was there before.
   */
  crmLocationId: z.string().max(120).nullable().optional(),
  credit: z
    .object({
      amountCents: z.number().int().refine(n => n !== 0, "Amount cannot be zero"),
      /**
       * Tenant-facing wording. This is exactly what the client reads in their
       * billing history, so it must never carry internal detail. Operator
       * identity goes to `createdBy`, which the tenant UI never renders.
       */
      label: z.string().min(2).max(160),
    })
    .optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    const { id } = await params

    const tenant = await prisma.tenant.findUnique({
      where:  { id },
      select: {
        id: true, creditBalanceCents: true, status: true,
        companyName: true, crmLocationId: true, minutesUsed: true,
        package: { select: { minutesIncluded: true, overageRateCents: true } },
      },
    })
    if (!tenant) return apiError(ERRORS.NOT_FOUND, 404)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Please check the values and try again.")

    const { status, packageId, credit, crmLocationId } = parsed.data

    // Two tenants pointing at one sub-account would silently merge their
    // callers' records, so it is refused rather than warned about.
    if (crmLocationId) {
      const clash = await prisma.tenant.findFirst({
        where:  { crmLocationId, id: { not: id } },
        select: { companyName: true },
      })
      if (clash) {
        return apiError(`That CRM sub-account is already assigned to ${clash.companyName}.`)
      }
    }
    /*
    * "Can they call?" is not "is the balance above zero".
    *
    * A tenant on a plan with allowance left calls for free — metering never
    * charges them, so pausing their agents because credit hit zero would take a
    * paying customer off the air for no reason.
    */
    const before = readAllowance({
      includedMinutes:  tenant.package?.minutesIncluded ?? 0,
      overageRateCents: tenant.package?.overageRateCents ?? 0,
      minutesUsed:      tenant.minutesUsed,
      balanceCents:     tenant.creditBalanceCents,
    })
    const couldCall = before.canCall

    // ── Status / package ────────────────────────────────────────────────
    if (status !== undefined || packageId !== undefined || crmLocationId !== undefined) {
      await prisma.tenant.update({
        where: { id },
        data: {
          ...(status !== undefined ? { status } : {}),
          ...(packageId !== undefined
            ? { packageId, packageAssignedAt: packageId ? new Date() : null }
            : {}),
          ...(crmLocationId !== undefined ? { crmLocationId } : {}),
        },
      })

      // Drop the cached token for whichever sub-account they are leaving, so an
      // in-flight call cannot keep writing to it after the remap.
      if (crmLocationId !== undefined && tenant.crmLocationId) {
        forgetLocation(tenant.crmLocationId)
      }
    }

    // ── Manual credit adjustment ────────────────────────────────────────
    if (credit) {
      await prisma.$transaction([
        prisma.tenant.update({
          where: { id },
          data:  { creditBalanceCents: { increment: credit.amountCents } },
        }),
        prisma.creditLedger.create({
          data: {
            tenantId:    id,
            type:        credit.amountCents > 0 ? "MANUAL_CREDIT" : "MANUAL_DEDUCTION",
            amountCents: credit.amountCents,
            description: credit.label,   // shown to the tenant
            createdBy:   admin.email,    // audit only, never rendered tenant-side
          },
        }),
      ])
    }

    // ── Reconcile agent availability with the new balance ───────────────
    const after = await prisma.tenant.findUnique({
      where:  { id },
      select: {
        creditBalanceCents: true, status: true, minutesUsed: true,
        package: { select: { minutesIncluded: true, overageRateCents: true } },
      },
    })

    if (after) {
      const now = readAllowance({
        includedMinutes:  after.package?.minutesIncluded ?? 0,
        overageRateCents: after.package?.overageRateCents ?? 0,
        minutesUsed:      after.minutesUsed,
        balanceCents:     after.creditBalanceCents,
      })
      const suspended = after.status === "BLOCKED" || after.status === "INACTIVE"
      const canCall   = now.canCall

      if (!couldCall && canCall && !suspended) {
        const agents = await prisma.agent.findMany({
          where:  { tenantId: id, status: "INACTIVE" },
          select: { id: true, vapiAssistantId: true },
        })
        if (agents.length) await enableAllTenantAgents(id, agents)
      }

      if (couldCall && (!canCall || suspended)) {
        const agents = await prisma.agent.findMany({
          where:  { tenantId: id, status: "ACTIVE" },
          select: { id: true, vapiAssistantId: true },
        })
        if (agents.length) await disableAllTenantAgents(id, agents)
      }
    }

    // ── Tell the tenant what changed ────────────────────────────────────
    const recipients = await billingRecipients(id)

    if (recipients.length) {
      if (credit && credit.amountCents > 0) {
        await sendCreditGranted({
          to: recipients,
          companyName:  tenant.companyName,
          amountCents:  credit.amountCents,
          label:        credit.label,
          balanceCents: after?.creditBalanceCents ?? 0,
        })
      }

      if (status === "ACTIVE" && tenant.status !== "ACTIVE") {
        await sendWorkspaceActivated({
          to: recipients,
          companyName: tenant.companyName,
        })
      }
    }

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/tenants/update"))
  }
}
