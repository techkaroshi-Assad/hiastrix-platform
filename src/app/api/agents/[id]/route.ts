/**
 * PATCH  /api/agents/[id] — update config, or toggle active state.
 * DELETE /api/agents/[id] — remove from Vapi and from our records.
 *
 * Both re-resolve the tenant from the session and match it against the agent
 * row before touching anything, so an id from another tenant reads as "not
 * found" rather than leaking its existence.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { vapiAssistants } from "@/lib/vapi/client"
import { AgentConfigInputSchema, readConfig } from "@/lib/vapi/config"
import { AgentPatchSchema, firstIssue } from "@/lib/vapi/agent"
import { applyAgentAvailability } from "@/lib/agents/availability"
import { buildAssistantPayload } from "@/lib/vapi/payload"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"


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

    const parsed = AgentPatchSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(firstIssue(parsed.error))

    const patch = parsed.data

    // A status-only request is the enable/disable toggle.
    const isToggleOnly = Object.keys(patch).length === 1 && patch.status !== undefined

    // Merge, never replace.
    //
    // A partial `config` in the body used to reset every omitted key to its
    // default, because zod fills defaults on parse. Harmless while only the
    // full form posted; a live footgun the moment a JSON editor lets someone
    // delete a line. ConfigPatchSchema keeps "omitted" distinct from
    // "explicitly default", so we merge onto the stored value and validate the
    // result — cross-tool rules included.
    const storedConfig = readConfig(agent.config)
    const nextConfig = AgentConfigInputSchema.parse(
      patch.config ? { ...storedConfig, ...patch.config } : storedConfig
    )

    try {
      if (isToggleOnly) {
        // Availability lives on the phone number, not the assistant — the
        // assistant has no on/off switch. See lib/agents/availability.ts.
        await applyAgentAvailability([
          {
            id:              agent.id,
            vapiAssistantId: agent.vapiAssistantId,
            status:          patch.status as "ACTIVE" | "INACTIVE",
          },
        ])
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
        // The merged value, not the raw patch — that is the whole point.
        ...(patch.config ? { config: nextConfig } : {}),
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
