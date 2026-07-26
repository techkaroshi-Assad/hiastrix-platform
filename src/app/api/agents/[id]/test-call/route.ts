/**
 * POST /api/agents/[id]/test-call — place an outbound test call.
 *
 * Entirely server-side: the browser sends a destination number and gets back
 * nothing but an acknowledgement. No key, no assistant id, no provider error.
 *
 * Test calls consume the same resources as real ones, so they bill identically
 * (spec §4.2.4). We therefore refuse when the workspace is out of balance,
 * rather than letting a "test" quietly run up an overage.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { vapiCalls } from "@/lib/vapi/client"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  // E.164, e.g. +447700900123
  number: z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a number in international format, e.g. +14155550123."),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)
    if (ctx.tenant.status !== "ACTIVE") return apiError(ERRORS.ACCOUNT_PENDING, 403)

    const agent = await prisma.agent.findFirst({
      where: { id, tenantId: ctx.tenant.id },
    })
    if (!agent) return apiError(ERRORS.NOT_FOUND, 404)

    if (agent.status !== "ACTIVE") {
      return apiError("Enable this agent before placing a test call.")
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? ERRORS.FALLBACK)
    }

    // A test call bills like any other, so the same gate applies.
    if (ctx.tenant.creditBalanceCents <= 0 && ctx.tenant.package) {
      const cap = ctx.tenant.package.minutesIncluded
      if (ctx.tenant.minutesUsed >= cap) return apiError(ERRORS.PAYMENT_REQUIRED, 402)
    }

    // Outbound needs one of the tenant's own numbers as the caller ID.
    const number =
      (await prisma.phoneNumber.findFirst({
        where: { tenantId: ctx.tenant.id, agentId: agent.id, status: "ACTIVE" },
      })) ??
      (await prisma.phoneNumber.findFirst({
        where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
      }))

    if (!number) {
      return apiError(
        "You need a phone number allocated to your workspace before placing a test call."
      )
    }

    try {
      await vapiCalls.create({
        assistantId:   agent.vapiAssistantId,
        phoneNumberId: number.vapiPhoneNumberId,
        customer:      { number: parsed.data.number },
      })
    } catch (err) {
      return apiError(sanitiseError(err, "agents/test-call/provider"))
    }

    return Response.json({
      message: `Calling ${parsed.data.number} now — it should ring within a few seconds.`,
    })
  } catch (error) {
    return apiError(sanitiseError(error, "agents/test-call"))
  }
}
