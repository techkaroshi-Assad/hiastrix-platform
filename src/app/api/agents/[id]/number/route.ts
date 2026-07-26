/**
 * PUT /api/agents/[id]/number — attach or detach a phone number.
 *
 * Body: { phoneNumberId: string | null }
 *
 * Only numbers Astrix has allocated to this tenant are selectable. A number
 * belonging to another tenant reads as "not found", so allocation is never
 * discoverable across tenant boundaries.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { vapiPhoneNumbers } from "@/lib/vapi/client"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  phoneNumberId: z.string().uuid().nullable(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    const agent = await prisma.agent.findFirst({
      where: { id, tenantId: ctx.tenant.id },
    })
    if (!agent) return apiError(ERRORS.NOT_FOUND, 404)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(ERRORS.FALLBACK)

    const { phoneNumberId } = parsed.data

    // Detach whatever is currently pointing at this agent.
    const current = await prisma.phoneNumber.findFirst({
      where: { agentId: agent.id, tenantId: ctx.tenant.id },
    })

    if (current && current.id !== phoneNumberId) {
      try {
        await vapiPhoneNumbers.assignAssistant(current.vapiPhoneNumberId, null)
      } catch (err) {
        return apiError(sanitiseError(err, "agents/number/detach"))
      }
      await prisma.phoneNumber.update({
        where: { id: current.id },
        data: { agentId: null },
      })
    }

    if (phoneNumberId === null) return Response.json({ ok: true })

    const next = await prisma.phoneNumber.findFirst({
      where: { id: phoneNumberId, tenantId: ctx.tenant.id },
    })
    if (!next) return apiError(ERRORS.NOT_FOUND, 404)

    try {
      await vapiPhoneNumbers.assignAssistant(next.vapiPhoneNumberId, agent.vapiAssistantId)
    } catch (err) {
      return apiError(sanitiseError(err, "agents/number/attach"))
    }

    await prisma.phoneNumber.update({
      where: { id: next.id },
      data: { agentId: agent.id },
    })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "agents/number"))
  }
}
