/**
 * PATCH /api/admin/numbers/[id] — allocate a number to a tenant, release it,
 * or set how many calls it may place in a day.
 *
 * Reallocating away from a tenant also detaches the number from whatever agent
 * was answering on it, both locally and upstream, so a number can never keep
 * ringing into the previous tenant's assistant.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { vapiPhoneNumbers } from "@/lib/vapi/client"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  // Optional now that this route does more than allocate: a request that
  // only changes the daily cap must not clear the tenant.
  tenantId: z.string().uuid().nullable().optional(),
  status:   z.enum(["ACTIVE", "INACTIVE"]).optional(),
  /** Null restores the platform default. */
  dailyCallCap: z.number().int().min(1).max(5_000).nullable().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    const { id } = await params

    const number = await prisma.phoneNumber.findUnique({ where: { id } })
    if (!number) return apiError(ERRORS.NOT_FOUND, 404)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(ERRORS.FALLBACK)

    const { status, dailyCallCap } = parsed.data
    // Distinguish "not mentioned" from "explicitly cleared".
    const changingTenant = "tenantId" in parsed.data
    const tenantId = changingTenant ? parsed.data.tenantId ?? null : number.tenantId

    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { id: true },
      })
      if (!tenant) return apiError(ERRORS.NOT_FOUND, 404)
    }

    const movingTenant = changingTenant && number.tenantId !== tenantId

    // Detach the answering agent whenever the number changes hands.
    if (movingTenant && number.agentId) {
      try {
        await vapiPhoneNumbers.assignAssistant(number.vapiPhoneNumberId, null)
      } catch (err) {
        return apiError(sanitiseError(err, "admin/numbers/detach"))
      }
    }

    await prisma.phoneNumber.update({
      where: { id },
      data: {
        ...(changingTenant ? { tenantId } : {}),
        ...(movingTenant ? { agentId: null } : {}),
        ...(status ? { status } : {}),
        ...("dailyCallCap" in parsed.data ? { dailyCallCap } : {}),
      },
    })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/numbers/update"))
  }
}
