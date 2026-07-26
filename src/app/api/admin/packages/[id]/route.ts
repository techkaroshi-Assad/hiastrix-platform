/** PATCH /api/admin/packages/[id] — edit a tier or retire it. */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const PatchSchema = z.object({
  name:             z.string().min(2).max(60).optional(),
  minutesIncluded:  z.number().int().min(1).max(1_000_000).optional(),
  priceCents:       z.number().int().min(0).max(100_000_000).optional(),
  overageRateCents: z.number().int().min(0).max(10_000).optional(),
  isActive:         z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    const { id } = await params

    const parsed = PatchSchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Please check the package details and try again.")

    const existing = await prisma.package.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return apiError(ERRORS.NOT_FOUND, 404)

    await prisma.package.update({ where: { id }, data: parsed.data })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/packages/update"))
  }
}
