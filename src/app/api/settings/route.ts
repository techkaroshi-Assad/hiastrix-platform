/**
 * PATCH /api/settings — update the tenant's own profile fields.
 *
 * Only the owner may rename the workspace; account managers are Astrix staff
 * scoped to the tenant and do not own its identity.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  companyName: z.string().min(2).max(120),
})

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)
    if (ctx.role !== "OWNER") return apiError(ERRORS.UNAUTHORIZED, 403)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Please enter a company name of at least 2 characters.")

    await prisma.tenant.update({
      where: { id: ctx.tenant.id },
      data:  { companyName: parsed.data.companyName },
    })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "settings/update"))
  }
}
