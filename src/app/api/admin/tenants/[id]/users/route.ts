/**
 * POST /api/admin/tenants/[id]/users — add an account manager to a tenant.
 *
 * Account managers are Astrix staff scoped to one tenant's dashboard. They are
 * created here and nowhere else — there is no self-signup for them.
 *
 * The identity is created with the service-role client, which is why this only
 * ever runs behind an admin check. If the local row fails to write we delete
 * the identity again, so a half-created login can never linger.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { createServiceClient } from "@/lib/supabase/server"
import { sendAccountManagerInvite } from "@/lib/email"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  name:     z.string().min(2).max(120),
  email:    z.string().email(),
  password: z.string().min(10).max(200),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    const { id } = await params

    const tenant = await prisma.tenant.findUnique({
      where:  { id },
      select: { id: true, companyName: true },
    })
    if (!tenant) return apiError(ERRORS.NOT_FOUND, 404)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ??
          "Enter a name, a valid email, and a password of at least 10 characters."
      )
    }

    const { name, email, password } = parsed.data

    const existing = await prisma.tenantUser.findUnique({
      where:  { email: email.toLowerCase() },
      select: { id: true },
    })
    if (existing) return apiError(ERRORS.EMAIL_ALREADY_EXISTS)

    const service = createServiceClient()

    const { data, error } = await service.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { name, role: "account_manager" },
      app_metadata:  { role: "account_manager" },
    })

    if (error || !data.user) {
      return apiError(sanitiseError(error, "admin/tenant-users/identity"))
    }

    try {
      await prisma.tenantUser.create({
        data: {
          tenantId:   tenant.id,
          supabaseId: data.user.id,
          email:      email.toLowerCase(),
          name,
          type:       "ACCOUNT_MANAGER",
        },
      })
    } catch (dbError) {
      try {
        await service.auth.admin.deleteUser(data.user.id)
      } catch (cleanupError) {
        console.error("[admin/tenant-users/cleanup]", cleanupError)
      }
      return apiError(sanitiseError(dbError, "admin/tenant-users/db"))
    }

    await sendAccountManagerInvite({
      to: email.toLowerCase(),
      name,
      companyName: tenant.companyName,
      password,
    })

    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/tenant-users"))
  }
}
