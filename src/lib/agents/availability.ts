/**
 * Turning an agent on and off — SERVER ONLY.
 *
 * There is no such thing as a disabled assistant at the voice provider. The
 * assistant object has no `isActive`, no `status`, no `enabled` — we were
 * PATCHing a field that does not exist, and the provider rejects unknown
 * properties, so every toggle failed with:
 *
 *     property isActive should not exist
 *
 * That mattered well beyond the button. The same call backed
 * `disableAllTenantAgents`, so the rule that pauses a tenant when their credit
 * runs out silently did nothing — calls kept connecting and kept costing money.
 *
 * What actually controls availability is the phone number. Inbound calls reach
 * an assistant because a number points at it, so clearing that pointer is how a
 * number stops being answered. Outbound is already ours to refuse: every
 * outbound path names an assistant explicitly, and each one checks the agent's
 * status first.
 *
 * So `agents.status` in our database is the source of truth, and this module is
 * what makes the provider agree with it.
 */

import { prisma } from "@/lib/prisma"
import { vapiPhoneNumbers } from "@/lib/vapi/client"

type Availability = "ACTIVE" | "INACTIVE"

/**
 * Point every number belonging to these agents at the right place.
 *
 * An agent with no number attached needs nothing done upstream: with no number
 * it cannot receive an inbound call, and outbound is gated on our side. Its
 * status is simply a fact about our own record.
 *
 * Settled, not awaited-all: one number failing must not leave the others in an
 * unknown state, and this is called from billing paths where throwing would
 * abandon work that has already half happened. Failures are logged and left for
 * `reconcileAgentNumbers` to pick up.
 */
export async function applyAgentAvailability(
  agents: { id: string; vapiAssistantId: string; status: Availability }[]
): Promise<void> {
  if (!agents.length) return

  const numbers = await prisma.phoneNumber.findMany({
    where:  { agentId: { in: agents.map(a => a.id) } },
    select: { id: true, agentId: true, vapiPhoneNumberId: true },
  })
  if (!numbers.length) return

  const statusOf = new Map(agents.map(a => [a.id, a]))

  const results = await Promise.allSettled(
    numbers.map(number => {
      const agent = statusOf.get(number.agentId!)
      if (!agent) return Promise.resolve()

      // null detaches. Proven by the number-assignment route, which has been
      // clearing assignments this way since before any of this existed.
      return vapiPhoneNumbers.assignAssistant(
        number.vapiPhoneNumberId,
        agent.status === "ACTIVE" ? agent.vapiAssistantId : null
      )
    })
  )

  const failed = results.filter(r => r.status === "rejected")
  if (failed.length) {
    console.error(
      `[agents/availability] ${failed.length} of ${numbers.length} numbers did not update`,
      failed.map(f => (f as PromiseRejectedResult).reason)
    )
  }
}

/** One agent, by id. Reads its current stored status. */
export async function applyOneAgentAvailability(agentId: string): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where:  { id: agentId },
    select: { id: true, vapiAssistantId: true, status: true },
  })
  if (agent) {
    await applyAgentAvailability([
      { ...agent, status: agent.status as Availability },
    ])
  }
}

/**
 * Make the provider match our database for a whole tenant.
 *
 * Worth having as its own function because the two can drift: a failed detach
 * above, a number reassigned by hand upstream, or — the case that prompted this
 * module — a long period where the toggle never worked at all and every agent
 * upstream is still answering regardless of what we recorded.
 *
 * Safe to run at any time; it only ever writes what the database already says.
 */
export async function reconcileAgentNumbers(tenantId: string): Promise<void> {
  const agents = await prisma.agent.findMany({
    where:  { tenantId },
    select: { id: true, vapiAssistantId: true, status: true },
  })
  await applyAgentAvailability(
    agents.map((a: { id: string; vapiAssistantId: string; status: string }) => ({
      id: a.id,
      vapiAssistantId: a.vapiAssistantId,
      status: a.status as Availability,
    }))
  )
}
