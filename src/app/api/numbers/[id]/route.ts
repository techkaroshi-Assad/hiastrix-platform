/**
 * PUT /api/numbers/[id] — point a number at an agent, or at nobody.
 *
 * Assignment is expressed number-side, because that is the shape of the thing:
 * a number routes to exactly one agent, and an agent may be reached on several
 * numbers — a main line and a campaign line landing on the same receptionist is
 * an ordinary arrangement, not an edge case.
 *
 * This replaces an agent-side route that set "the agent's number", which forced
 * one number per agent by detaching whichever number was already pointing there.
 * Nothing upstream required that; it was our own limitation.
 *
 * Allocation is a separate concern and stays in the admin console — a tenant can
 * only ever assign numbers Astrix has already given them.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { vapiPhoneNumbers } from "@/lib/vapi/client"
import { applyOneAgentAvailability } from "@/lib/agents/availability"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  agentId: z.string().uuid().nullable(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    // Scoped to the tenant, so a number belonging to someone else reads as
    // missing rather than forbidden — allocation stays undiscoverable.
    const number = await prisma.phoneNumber.findFirst({
      where:  { id, tenantId: ctx.tenant.id },
      select: { id: true, vapiPhoneNumberId: true, agentId: true },
    })
    if (!number) return apiError(ERRORS.NOT_FOUND, 404)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(ERRORS.FALLBACK)

    const { agentId } = parsed.data
    if (agentId === number.agentId) return Response.json({ ok: true })

    if (agentId) {
      const agent = await prisma.agent.findFirst({
        where:  { id: agentId, tenantId: ctx.tenant.id },
        select: { id: true },
      })
      if (!agent) return apiError(ERRORS.NOT_FOUND, 404)
    }

    try {
      if (agentId) {
        await prisma.phoneNumber.update({ where: { id: number.id }, data: { agentId } })

        /*
         * Availability decides what actually happens upstream. Attaching a
         * number to a disabled agent must NOT put it on the air — otherwise
         * assigning a number silently re-enables an agent that was switched
         * off, or worse, one that billing paused for an empty balance.
         */
        await applyOneAgentAvailability(agentId)
      } else {
        // Detach this number only. Whatever else the agent answers on is
        // untouched, which is the whole point of the change.
        await vapiPhoneNumbers.assignAssistant(number.vapiPhoneNumberId, null)
        await prisma.phoneNumber.update({
          where: { id: number.id },
          data:  { agentId: null },
        })
      }
    } catch (err) {
      return apiError(sanitiseError(err, "numbers/assign/provider"))
    }

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "numbers/assign"))
  }
}
