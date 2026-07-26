/**
 * POST /api/agents — create an agent for the caller's tenant.
 *
 * Order of operations matters: the assistant is created on Vapi first, then
 * recorded locally. If the local write fails we delete the remote assistant
 * again, so we never leave an orphan the tenant can neither see nor bill.
 *
 * No vendor name, URL, key or raw error string is ever returned to the client.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { vapiAssistants } from "@/lib/vapi/client"
import { buildAssistantPayload } from "@/lib/vapi/options"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const AgentSchema = z.object({
  name:                 z.string().min(2).max(60),
  systemPrompt:         z.string().min(10).max(8000),
  firstMessage:         z.string().min(1).max(1000),
  voice:                z.string().min(1),
  model:                z.string().min(1),
  recordingEnabled:     z.boolean(),
  transcriptionEnabled: z.boolean(),
  endCallPhrases:       z.array(z.string().min(1)).max(10).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (ctx.tenant.status === "BLOCKED") return apiError(ERRORS.ACCOUNT_BLOCKED, 403)
    if (ctx.tenant.status === "PENDING") return apiError(ERRORS.ACCOUNT_PENDING, 403)

    const parsed = AgentSchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Please check the agent details and try again.")

    const input = parsed.data

    // 1. Create on Vapi.
    let vapiAssistantId: string
    try {
      const created = (await vapiAssistants.create(
        buildAssistantPayload(input)
      )) as { id?: string }

      if (!created?.id) throw new Error("assistant created without an id")
      vapiAssistantId = created.id
    } catch (err) {
      return apiError(sanitiseError(err, "agents/create/provider"))
    }

    // 2. Record locally — roll the remote assistant back if this fails.
    try {
      const agent = await prisma.agent.create({
        data: {
          tenantId:             ctx.tenant.id,
          vapiAssistantId,
          name:                 input.name,
          status:               "ACTIVE",
          voice:                input.voice,
          model:                input.model,
          systemPrompt:         input.systemPrompt,
          firstMessage:         input.firstMessage,
          recordingEnabled:     input.recordingEnabled,
          transcriptionEnabled: input.transcriptionEnabled,
        },
        select: { id: true, name: true },
      })

      return Response.json({ agent }, { status: 201 })
    } catch (dbError) {
      try {
        await vapiAssistants.delete(vapiAssistantId)
      } catch (cleanupError) {
        console.error("[agents/create/cleanup]", cleanupError)
      }
      return apiError(sanitiseError(dbError, "agents/create/db"))
    }
  } catch (error) {
    return apiError(sanitiseError(error, "agents/create"))
  }
}
