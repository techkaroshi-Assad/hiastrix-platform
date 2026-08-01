/**
 * POST /api/tools/crm — CRM actions, executed mid-call.
 *
 * The voice provider calls this while a caller is on the line, so two things
 * govern everything here: it must answer in the provider's tool-result shape or
 * the caller hears silence, and it must never fail in a way that leaves the agent
 * with nothing to say. Every error path returns a spoken sentence with a 200.
 *
 * ── The security boundary ──────────────────────────────────────────────────
 *
 * Which sub-account this call may touch is derived from the assistant that
 * placed it:
 *
 *     assistantId → agent → tenant → tenant.crmLocationId
 *
 * Nothing in the request body is trusted for that, and nor are the tool's own
 * settings — the calendar, pipeline and allowed tags are re-read from the stored
 * agent config rather than taken from the payload. A malformed or forged call can
 * therefore reach no sub-account other than the one its assistant belongs to.
 *
 * This route is excluded from the proxy matcher, because the provider carries no
 * session. It authenticates on the shared secret instead.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { authorisedByVapiSecret } from "@/lib/vapi/webhook-auth"
import { readConfig } from "@/lib/vapi/config"
import { runCrmAction } from "@/lib/crm/handlers"

export const dynamic = "force-dynamic"

type ToolCall = {
  id?: string
  toolCallId?: string
  name?: string
  arguments?: unknown
  function?: { name?: string; arguments?: unknown }
}

/** Spoken back to the caller, so it says what to do rather than what broke. */
const TROUBLE = "I couldn't reach the system just then."

/**
 * How long we may take before answering with something rather than nothing.
 *
 * The voice provider abandons a tool call at eight seconds and hands the model
 * its own error — on a live call that produced
 * `Your server rejected tool-calls webhook. Error: timeout of 8000ms exceeded`,
 * which the model can do nothing sensible with. Answering at six and a half
 * seconds with a plain sentence is worse than being fast and far better than
 * being cut off: the agent apologises like a person instead of stalling.
 *
 * The gap to eight is for the round trip in both directions, which is not ours
 * to measure and not zero.
 */
const BUDGET_MS = Number(process.env.CRM_TOOL_BUDGET_MS ?? 6500) || 6500

/**
 * Actions that are safe to attempt again.
 *
 * Aborting our wait does not abort the request already in flight at the CRM, so
 * a timeout means we genuinely do not know whether the write landed. For a
 * lookup that does not matter. For a note or a booking it matters a great deal:
 * telling the model to try again would write the note twice or double-book the
 * caller, and both are worse than the original failure.
 *
 * Creating a contact is on the safe list because it now re-checks for the
 * person before creating one, so a second attempt finds the first.
 */
const RETRY_SAFE = new Set([
  "crm.contact.find",
  "crm.contact.create",
  "crm.appointment.availability",
  "crm.tag.add",
  "crm.tag.remove",
])

function timedOutMessage(toolType: string): string {
  return RETRY_SAFE.has(toolType)
    ? "That's taking longer than usual. Tell the caller you'll try again in a moment, then try once more."
    : "I couldn't confirm whether that went through. Do not try it again — tell the caller someone will confirm it shortly."
}

/**
 * Answer within the budget, whatever happens.
 *
 * Deliberately does not cancel the underlying work: there is no cancellation to
 * hand down to the CRM, and pretending otherwise would be a lie in the code.
 * The request runs on, and its result is discarded.
 */
async function withinBudget(
  work: Promise<string>,
  ms: number,
  onTimeout: () => string
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bell = new Promise<string>(resolve => {
    timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms))
  })

  try {
    return await Promise.race([work, bell])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The provider's expected shape. A bare { ok: true } here would be accepted and
 *  then leave the model waiting for a result that never comes. */
const results = (rows: { toolCallId: string; result: string }[]) =>
  Response.json({ results: rows })

/** Arguments arrive as an object on some providers' payloads and a JSON string
 *  on others. Both are normal; neither should throw. */
function readArgs(call: ToolCall): Record<string, unknown> {
  const raw = call.arguments ?? call.function?.arguments
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* fall through */
    }
  }
  return {}
}

export async function POST(request: NextRequest) {
  // Stamped before anything else, because the budget is measured against when
  // the provider started waiting, not when we got round to the work.
  const receivedAt = Date.now()

  if (!authorisedByVapiSecret(request)) {
    return new Response(null, { status: 401 })
  }

  let body: { message?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }

  const message = body.message ?? {}
  const calls   = (Array.isArray(message.toolCallList) ? message.toolCallList : []) as ToolCall[]
  if (!calls.length) return results([])

  const idOf = (c: ToolCall, i: number) => c.toolCallId ?? c.id ?? `call_${i}`

  try {
    const call        = (message.call ?? {}) as { assistantId?: string }
    const assistantId =
      call.assistantId ?? (message.assistant as { id?: string } | undefined)?.id

    const agent = assistantId
      ? await prisma.agent.findUnique({
          where:  { vapiAssistantId: assistantId },
          select: { config: true, tenant: { select: { crmLocationId: true, status: true } } },
        })
      : null

    // An assistant we do not own, or one whose workspace has no CRM mapped. Both
    // are answered plainly rather than with an error the agent would read out.
    if (!agent) {
      return results(calls.map((c, i) => ({
        toolCallId: idOf(c, i),
        result: "That action isn't available on this account.",
      })))
    }

    const locationId = agent.tenant.crmLocationId
    if (!locationId || agent.tenant.status === "BLOCKED") {
      return results(calls.map((c, i) => ({
        toolCallId: idOf(c, i),
        result: "This workspace isn't connected to a CRM, so I can't record that.",
      })))
    }

    // Settings come from what was saved, never from the payload.
    const config = readConfig(agent.config)

    const rows = await Promise.all(calls.map(async (c, i) => {
      const toolCallId = idOf(c, i)
      const name       = c.name ?? c.function?.name ?? ""
      const tool       = config.tools.find(t => t.name === name)

      if (!tool || !tool.type.startsWith("crm.")) {
        return { toolCallId, result: "That action isn't set up on this agent." }
      }

      const startedAt = Date.now()
      let timedOut = false

      try {
        const result = await withinBudget(
          runCrmAction(tool, locationId, readArgs(c)),
          // Measured from when the request arrived, not from here, so several
          // actions in one payload share the budget rather than each getting a
          // fresh one and the last of them running past the ceiling anyway.
          BUDGET_MS - (Date.now() - receivedAt),
          () => { timedOut = true; return timedOutMessage(tool.type) }
        )

        const took = Date.now() - startedAt
        // Logged for every slow action, not only the ones that ran out. This is
        // the only place the latency is visible, and knowing which action is
        // near the ceiling is how the cause gets found before it crosses it.
        if (timedOut || took > 3000) {
          console.warn(`[tools/crm] ${timedOut ? "TIMED OUT" : "slow"} ${tool.type} ${took}ms`)
        }

        return { toolCallId, result }
      } catch (error) {
        // One failing action must not take the others down with it, and the
        // provider's message never reaches the caller.
        console.error("[tools/crm]", name, `${Date.now() - startedAt}ms`, error)
        return { toolCallId, result: TROUBLE }
      }
    }))

    return results(rows)
  } catch (error) {
    console.error("[tools/crm]", error)
    return results(calls.map((c, i) => ({ toolCallId: idOf(c, i), result: TROUBLE })))
  }
}
