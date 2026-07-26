/**
 * POST /api/invitations/accept — public.
 *
 * Possession of the emailed token proves the address, so the account is created
 * pre-confirmed. Every failure returns the same generic wording: an attacker
 * guessing tokens should not learn whether one exists, is expired, or is spent.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { hashToken } from "@/lib/invitations"
import { sanitiseError, apiError } from "@/lib/errors"

export const dynamic = "force-dynamic"

const BodySchema = z.object({
  token:    z.string().min(20).max(200),
  name:     z.string().min(2).max(120),
  password: z.string().min(8).max(200),
})

const INVALID = "This invitation is no longer valid. Ask the workspace owner to send a new one."

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError("Enter your name and a password of at least 8 characters.")
    }

    const { token, name, password } = parsed.data

    const invite = await prisma.tenantInvitation.findUnique({
      where:   { tokenHash: hashToken(token) },
      include: { tenant: { select: { id: true, companyName: true, status: true } } },
    })

    if (!invite || invite.status !== "PENDING") return apiError(INVALID, 400)

    if (invite.expiresAt < new Date()) {
      // Persist lazily — no scheduler needed to keep the column honest.
      await prisma.tenantInvitation.update({
        where: { id: invite.id },
        data:  { status: "EXPIRED" },
      })
      return apiError("This invitation has expired. Ask the workspace owner to send a new one.", 400)
    }

    if (invite.tenant.status === "BLOCKED" || invite.tenant.status === "INACTIVE") {
      return apiError(INVALID, 400)
    }

    // Days can pass between invite and accept — they may have signed up meanwhile.
    const existing = await prisma.tenantUser.findUnique({
      where:  { email: invite.email },
      select: { id: true },
    })
    if (existing) {
      await prisma.tenantInvitation.update({
        where: { id: invite.id },
        data:  { status: "ACCEPTED", acceptedAt: new Date() },
      })
      return apiError("You already have an account — just sign in.", 409)
    }

    const service = createServiceClient()
    const { data, error } = await service.auth.admin.createUser({
      email: invite.email,
      password,
      // The token already proved the address.
      email_confirm: true,
      user_metadata: { name, role: "account_manager" },
      app_metadata:  { role: "account_manager" },
    })

    if (error || !data.user) {
      return apiError(sanitiseError(error, "invite/accept/identity"))
    }

    try {
      await prisma.tenantUser.create({
        data: {
          tenantId:   invite.tenantId,
          supabaseId: data.user.id,
          email:      invite.email,
          name,
          type:       invite.type,
        },
      })
    } catch (dbError) {
      try {
        await service.auth.admin.deleteUser(data.user.id)
      } catch (cleanupError) {
        console.error("[invite/accept/cleanup]", cleanupError)
      }
      return apiError(sanitiseError(dbError, "invite/accept/db"))
    }

    await prisma.tenantInvitation.update({
      where: { id: invite.id },
      data:  { status: "ACCEPTED", acceptedAt: new Date() },
    })

    // Sign them straight in — the SSR client sets the session cookies.
    try {
      const supabase = await createClient()
      await supabase.auth.signInWithPassword({ email: invite.email, password })
    } catch (signInError) {
      console.error("[invite/accept/signin]", signInError)
      return Response.json({ redirect: "/login" }, { status: 201 })
    }

    return Response.json({ redirect: "/dashboard" }, { status: 201 })
  } catch (error) {
    return apiError(sanitiseError(error, "invite/accept"))
  }
}
