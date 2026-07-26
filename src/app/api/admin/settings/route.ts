/**
 * PATCH /api/admin/settings — platform-wide configuration.
 *
 * The overage rate here is the default applied to newly created packages;
 * existing packages keep the rate they were created with, so changing this
 * never silently reprices a tenant mid-contract.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  overageRateCents: z.number().int().min(0).max(10_000).optional(),
  lowBalancePct:    z.number().int().min(1).max(90).optional(),
  supportEmail:     z.string().email().optional(),
})

export async function PATCH(request: NextRequest) {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)
    if (admin.role !== "SUPER_ADMIN") {
      return apiError("Only a super admin can change platform settings.", 403)
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Please check the values and try again.")

    await prisma.platformSettings.upsert({
      where:  { id: true },
      update: { ...parsed.data, updatedBy: admin.email },
      create: { id: true, ...parsed.data, updatedBy: admin.email },
    })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/settings"))
  }
}
