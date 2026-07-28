/**
 * POST /api/agents/[id]/web-call — credentials for an in-browser test call.
 *
 * The Vapi Web SDK runs in the page and needs a *public* key. That key is
 * designed for client-side use and grants only the ability to start a web call
 * — it is not the private API key, which never leaves the server.
 *
 * Even so, it is handed out narrowly: only to a signed-in member of an ACTIVE
 * tenant, only for an agent that tenant owns, and only when the feature is
 * configured. If VAPI_PUBLIC_KEY is unset the browser path stays hidden and
 * the outbound test call remains available instead.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { verdictFor } from "@/lib/billing/can-call"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    // Browser calls bill like any other. Same single gate. See can-call.ts.
    const verdict = verdictFor(ctx.tenant)
    if (!verdict.ok) {
      return verdict.reason === "suspended"
        ? apiError(ERRORS.ACCOUNT_PENDING, 403)
        : apiError(verdict.allowance.stoppedReason ?? ERRORS.PAYMENT_REQUIRED, 402)
    }

    const publicKey = process.env.VAPI_PUBLIC_KEY
    if (!publicKey) {
      return apiError("In-browser calling isn't available on this workspace.", 503)
    }

    const agent = await prisma.agent.findFirst({
      where:  { id, tenantId: ctx.tenant.id },
      select: { vapiAssistantId: true, status: true },
    })
    if (!agent) return apiError(ERRORS.NOT_FOUND, 404)

    if (agent.status !== "ACTIVE") {
      return apiError("Enable this agent before starting a browser call.")
    }

    return Response.json({ publicKey, assistantId: agent.vapiAssistantId })
  } catch (error) {
    return apiError(sanitiseError(error, "agents/web-call"))
  }
}
