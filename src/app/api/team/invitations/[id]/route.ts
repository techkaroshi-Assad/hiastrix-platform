/**
 * DELETE /api/team/invitations/[id] — revoke a pending invitation.
 * POST   /api/team/invitations/[id] — resend it, rotating the token.
 *
 * Both scope by tenantId inside the where clause, so an id belonging to another
 * workspace is a silent no-op rather than a 404 that confirms it exists.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { emailConfigured, sendTeamInvite } from "@/lib/email"
import { newInviteToken, inviteExpiry, inviteUrl } from "@/lib/invitations"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

async function requireOwner() {
  const ctx = await getTenantContext()
  if (!ctx) return { error: apiError(ERRORS.UNAUTHORIZED, 401) as Response }
  if (ctx.role !== "OWNER") {
    return { error: apiError("Only the workspace owner can manage invitations.", 403) as Response }
  }
  return { ctx }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireOwner()
    if ("error" in guard) return guard.error

    const { id } = await params

    await prisma.tenantInvitation.updateMany({
      where: { id, tenantId: guard.ctx.tenant.id, status: "PENDING" },
      data:  { status: "REVOKED" },
    })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "team/invite/revoke"))
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireOwner()
    if ("error" in guard) return guard.error

    const { id } = await params
    const { ctx } = guard

    const invite = await prisma.tenantInvitation.findFirst({
      where: { id, tenantId: ctx.tenant.id, status: "PENDING" },
    })
    if (!invite) return apiError(ERRORS.NOT_FOUND, 404)

    if (!emailConfigured()) {
      return apiError("Email isn't set up on this workspace, so there's nothing to resend.")
    }

    // Rotate rather than reuse: the old link stops working the moment a new one
    // is sent, which is what "resend" should mean.
    const { token, hash } = newInviteToken()
    const expiresAt = inviteExpiry()

    await prisma.tenantInvitation.update({
      where: { id: invite.id },
      data:  { tokenHash: hash, expiresAt },
    })

    await sendTeamInvite({
      to: invite.email,
      name: invite.name,
      companyName: ctx.tenant.companyName,
      inviterName: ctx.name,
      url: inviteUrl(token),
      expiresAt,
    })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "team/invite/resend"))
  }
}
