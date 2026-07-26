/**
 * POST /api/auth/signup
 *
 * Registers a new tenant owner.
 *
 * Supabase is called server-side only — no vendor URL, key, or error string
 * ever reaches the browser. Every failure path returns a message from ERRORS.
 */

import { NextRequest } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { prisma, type TransactionClient } from "@/lib/prisma"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"
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
    const appUrl = process.env.APP_URL ?? "https://app.hiastrix.com"

    // signUp (not admin.createUser) is what actually dispatches the
    // confirmation email. Runs on the anon key, server-side.
    const supabase = await createClient()

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, companyName, role: "tenant_owner" },
        emailRedirectTo: `${appUrl}/auth/callback?next=/dashboard`,
      },
    })

    if (authError || !authData.user) {
      return apiError(sanitiseError(authError, "signup/auth"))
    }

    // Supabase returns a decoy user with zero identities when the address is
    // already registered — treat that as a duplicate, not a new signup.
    if (Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
      return apiError(ERRORS.EMAIL_ALREADY_EXISTS)
    }

    const supabaseId = authData.user.id

    try {
      await prisma.$transaction(async (tx: TransactionClient) => {
        const tenant = await tx.tenant.create({
          data: {
            companyName,
            email,
            status: "PENDING",
          },
        })

        await tx.tenantUser.create({
          data: {
            tenantId: tenant.id,
            supabaseId,
            email,
            name,
            type: "OWNER",
          },
        })
      })
    } catch (dbError) {
      // Roll the auth user back so the address can be reused on retry —
      // otherwise the account exists with no workspace behind it.
      try {
        await createServiceClient().auth.admin.deleteUser(supabaseId)
      } catch (cleanupError) {
        console.error("[signup/cleanup]", cleanupError)
      }
      return apiError(sanitiseError(dbError, "signup/db"))
    }

    return Response.json(
      {
        message:
          "Account created. Check your inbox for a link to confirm your email address.",
      },
      { status: 201 }
    )
  } catch (error) {
    return apiError(sanitiseError(error, "signup"))
  }
}
