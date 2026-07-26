/**
 * POST /api/auth/signup
 *
 * Registers a new tenant owner.
 * Supabase is called server-side only — no Supabase URL or key
 * is ever exposed to the browser.
 */

import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { sanitiseError, apiError } from "@/lib/errors"
import { z } from "zod"

const SignupSchema = z.object({
  email:       z.string().email(),
  password:    z.string().min(8),
  companyName: z.string().min(2),
  name:        z.string().min(2),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = SignupSchema.safeParse(body)

    if (!parsed.success) {
      return apiError("Please check your details and try again.")
    }

    const { email, password, companyName, name } = parsed.data

    const supabase = createServiceClient()

    // Create auth user (server-side only — Supabase never touched by browser)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // triggers verification email
      user_metadata: { name, companyName, role: "tenant_owner" },
    })

    if (authError || !authData.user) {
      return apiError(sanitiseError(authError, "signup/auth"))
    }

    // Create tenant + user records in DB
    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          companyName,
          email,
          status: "PENDING",
        },
      })

      await tx.tenantUser.create({
        data: {
          tenantId:   tenant.id,
          supabaseId: authData.user.id,
          email,
          name,
          type:       "OWNER",
        },
      })
    })

    return Response.json(
      { message: "Account created. Please check your email to verify your address." },
      { status: 201 }
    )

  } catch (error) {
    return apiError(sanitiseError(error, "signup"))
  }
}
