/**
 * PATCH  /api/agents/[id] — update config, or toggle active state.
 * DELETE /api/agents/[id] — remove from Vapi and from our records.
 *
 * Both re-resolve the tenant from the session and match it against the agent
 * row before touching anything, so an id from another tenant reads as "not
 * found" rather than leaking its existence.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { vapiAssistants } from "@/lib/vapi/client"
import { AgentConfigSchema, readConfig } from "@/lib/vapi/config"
import { buildAssistantPayload } from "@/lib/vapi/payload"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const UpdateSchema = z.object({
  name:                 z.string().min(2).max(60).optional(),
  systemPrompt:         z.string().min(10).max(8000).optional(),
  firstMessage:         z.string().min(1).max(1000).optional(),
  voice:                z.string().min(1).optional(),
  model:                z.string().min(1).optional(),
  recordingEnabled:     z.boolean().optional(),
  transcriptionEnabled: z.boolean().optional(),
  config:               AgentConfigSchema.optional(),
  status:               z.enum(["ACTIVE", "INACTIVE"]).optional(),
})

async function loadOwnedAgent(id: string) {
  const ctx = await getTenantContext()
  if (!ctx) return { error: apiError(ERRORS.UNAUTHORIZED, 401) as Response }

  const agent = await prisma.agent.findFirst({
    where: { id, tenantId: ctx.tenant.id },
  })
  if (!agent) return { error: apiError(ERRORS.NOT_FOUND, 404) as Response }

  return { ctx, agent }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const found = await loadOwnedAgent(id)
    if ("error" in found) return found.error
    const { agent } = found

    const parsed = UpdateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Please check the agent details and try again."
      )
    }

    const patch = parsed.data

    // A status-only request is the enable/disable toggle.
    const isToggleOnly = Object.keys(patch).length === 1 && patch.status !== undefined

    // Merge over the stored record so a partial edit never blanks a field the
    // form did not send.
    const nextConfig = patch.config ?? readConfig(agent.config)

    try {
      if (isToggleOnly) {
        if (patch.status === "ACTIVE") await vapiAssistants.enable(agent.vapiAssistantId)
        else await vapiAssistants.disable(agent.vapiAssistantId)
      } else {
        await vapiAssistants.update(
          agent.vapiAssistantId,
          buildAssistantPayload(
            {
              name:                 patch.name                 ?? agent.name,
              systemPrompt:         patch.systemPrompt         ?? agent.systemPrompt ?? "",
              firstMessage:         patch.firstMessage         ?? agent.firstMessage ?? "",
              voice:                patch.voice                ?? agent.voice ?? "",
              model:                patch.model                ?? agent.model ?? "",
              recordingEnabled:     patch.recordingEnabled     ?? agent.recordingEnabled,
              transcriptionEnabled: patch.transcriptionEnabled ?? agent.transcriptionEnabled,
            },
            nextConfig
          )
        )
      }
    } catch (err) {
      return apiError(sanitiseError(err, "agents/update/provider"))
    }

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: {
        name:                 patch.name,
        systemPrompt:         patch.systemPrompt,
        firstMessage:         patch.firstMessage,
        voice:                patch.voice,
        model:                patch.model,
        recordingEnabled:     patch.recordingEnabled,
        transcriptionEnabled: patch.transcriptionEnabled,
        status:               patch.status,
        ...(patch.config ? { config: patch.config } : {}),
      },
      select: { id: true, status: true },
    })

    return Response.json({ agent: updated })
  } catch (error) {
    return apiError(sanitiseError(error, "agents/update"))
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const found = await loadOwnedAgent(id)
    if ("error" in found) return found.error
    const { agent } = found

    try {
      await vapiAssistants.delete(agent.vapiAssistantId)
    } catch (err) {
      // A 404 upstream means it is already gone — that should not block us
      // from clearing our own record, so log and continue.
      console.error("[agents/delete/provider]", err)
    }

    // Release any numbers pointing at this agent before removing it.
    await prisma.phoneNumber.updateMany({
      where: { agentId: agent.id },
      data: { agentId: null },
    })

    await prisma.agent.delete({ where: { id: agent.id } })

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "agents/delete"))
  }
}
