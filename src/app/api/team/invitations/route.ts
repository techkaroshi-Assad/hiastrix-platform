/**
 * POST /api/team/invitations — a workspace owner adds someone to their team.
 *
 * Two paths, chosen automatically:
 *
 *   Email configured   — send a link. No identity is created until they accept,
 *                        so an ignored invitation leaves nothing behind and the
 *                        invitee chooses their own password.
 *
 *   Email not configured — create the account immediately and return a
 *                        generated password, shown once. Returning a password
 *                        in a response body is normally indefensible; here it is
 *                        gated on owner-only, same-tenant, and email genuinely
 *                        being unavailable, and the response is no-store.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { createServiceClient } from "@/lib/supabase/server"
import { emailConfigured, sendTeamInvite } from "@/lib/email"
import {
  newInviteToken,
  newTempPassword,
  inviteExpiry,
  inviteUrl,
  MAX_PENDING_INVITES,
} from "@/lib/invitations"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  name:  z.string().min(2).max(120),
  email: z.string().email(),
  // Only one grantable role for now. Owner-invites-owner would hand over
  // workspace rename and further invites, which is a decision for a person and
  // not a dropdown.
  type:  z.literal("ACCOUNT_MANAGER").default("ACCOUNT_MANAGER"),
})

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)
    if (ctx.role !== "OWNER") {
      return apiError("Only the workspace owner can invite people.", 403)
    }
    if (ctx.tenant.status === "BLOCKED")  return apiError(ERRORS.ACCOUNT_BLOCKED, 403)
    if (ctx.tenant.status === "PENDING")  return apiError(ERRORS.ACCOUNT_PENDING, 403)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError("Enter a name and a valid email address.")
    }

    const name  = parsed.data.name.trim()
    const email = parsed.data.email.trim().toLowerCase()

    // tenant_users.email is globally unique, so a person belongs to exactly one
    // workspace. The wording has to reflect that, not "already in this team".
    const existingUser = await prisma.tenantUser.findUnique({
      where:  { email },
      select: { id: true },
    })
    if (existingUser) {
      return apiError("That address already has a Hi-Astrix account.")
    }

    const live = await prisma.tenantInvitation.findFirst({
      where:  { tenantId: ctx.tenant.id, email, status: "PENDING" },
      select: { id: true },
    })
    if (live) {
      return apiError("They already have an invitation. Resend or revoke it first.")
    }

    const pendingCount = await prisma.tenantInvitation.count({
      where: { tenantId: ctx.tenant.id, status: "PENDING" },
    })
    if (pendingCount >= MAX_PENDING_INVITES) {
      return apiError(
        `You can have ${MAX_PENDING_INVITES} invitations outstanding at once. Revoke one first.`
      )
    }

    /* ── Email path ────────────────────────────────────────────────── */
    if (emailConfigured()) {
      const { token, hash } = newInviteToken()
      const expiresAt = inviteExpiry()

      await prisma.tenantInvitation.create({
        data: {
          tenantId:  ctx.tenant.id,
          email,
          name,
          type:      "ACCOUNT_MANAGER",
          tokenHash: hash,
          invitedBy: ctx.email,
          expiresAt,
        },
      })

      await sendTeamInvite({
        to: email,
        name,
        companyName: ctx.tenant.companyName,
        inviterName: ctx.name,
        url: inviteUrl(token),
        expiresAt,
      })

      return Response.json({ mode: "email", email }, { status: 201 })
    }

    /* ── Instant path ──────────────────────────────────────────────── */
    const password = newTempPassword()
    const service  = createServiceClient()

    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: "account_manager" },
      app_metadata:  { role: "account_manager" },
    })

    if (error || !data.user) {
      return apiError(sanitiseError(error, "team/invite/identity"))
    }

    try {
      await prisma.tenantUser.create({
        data: {
          tenantId:   ctx.tenant.id,
          supabaseId: data.user.id,
          email,
          name,
          type:       "ACCOUNT_MANAGER",
        },
      })
    } catch (dbError) {
      // Never leave a login that belongs to no workspace.
      try {
        await service.auth.admin.deleteUser(data.user.id)
      } catch (cleanupError) {
        console.error("[team/invite/cleanup]", cleanupError)
      }
      return apiError(sanitiseError(dbError, "team/invite/db"))
    }

    // Recorded as already accepted so the team history is complete either way.
    await prisma.tenantInvitation.create({
      data: {
        tenantId:   ctx.tenant.id,
        email,
        name,
        type:       "ACCOUNT_MANAGER",
        tokenHash:  newInviteToken().hash,
        invitedBy:  ctx.email,
        status:     "ACCEPTED",
        expiresAt:  inviteExpiry(),
        acceptedAt: new Date(),
      },
    })

    return Response.json(
      { mode: "password", email, password },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return apiError(sanitiseError(error, "team/invite"))
  }
}
