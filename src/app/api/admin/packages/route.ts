/**
 * POST /api/admin/packages — create a package tier.
 * Amounts are USD cents end to end; the UI converts on the way in and out.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const PackageSchema = z.object({
  name:             z.string().min(2).max(60),
  minutesIncluded:  z.number().int().min(1).max(1_000_000),
  priceCents:       z.number().int().min(0).max(100_000_000),
  overageRateCents: z.number().int().min(0).max(10_000),
  isActive:         z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    const parsed = PackageSchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Please check the package details and try again.")

    const pkg = await prisma.package.create({
      data:   { ...parsed.data, isActive: parsed.data.isActive ?? true },
      select: { id: true, name: true },
    })

    return Response.json({ package: pkg }, { status: 201 })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/packages/create"))
  }
}
