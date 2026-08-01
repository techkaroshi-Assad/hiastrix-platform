/**
 * Where a workspace has got to, and what it needs next.
 *
 * ── WHY THIS IS ONE FUNCTION ──────────────────────────────────────────
 *
 * Setup guidance goes in several places — a bar across the top of every page, a
 * checklist on Overview, an empty state on Agents, a banner when calls stop.
 * Every one of those has to answer the same question, and the failure mode when
 * they each work it out for themselves is not a crash. It is worse than a
 * crash: the checklist says two of three done while the bar says you are
 * finished, and the tenant stops believing any of it.
 *
 * So the state is computed once, here, and everything reads from it.
 *
 * ── WHAT COUNTS AS DONE ───────────────────────────────────────────────
 *
 * Deliberately not "the row exists". An agent that exists but is switched off
 * does not answer the phone; a number that exists but points at nothing is a
 * number that rings out. Each step below asserts the thing a tenant would
 * actually mean, which is why `hasAgent` is a count of *live* agents and
 * `numberAttached` is a join rather than a count.
 *
 * ── THE ORDER IS NOT A PREFERENCE ─────────────────────────────────────
 *
 * A number has to exist before an agent can answer on it, and an agent has to
 * exist before a call can happen. Presenting these in any other order produces
 * a tenant stuck on a step they cannot complete yet, which is the single
 * fastest way to make somebody give up on a product.
 *
 * SERVER ONLY.
 */

import { prisma } from "@/lib/prisma"
import type { TenantContext } from "@/lib/tenant"

export type StepKey = "number" | "agent" | "attach" | "call"

export type SetupStep = {
  key: StepKey
  title: string
  /** What this step is for, in a sentence somebody would say out loud. */
  body: string
  href: string
  cta: string
  done: boolean
  /**
   * True when the tenant cannot do this themselves and is waiting on us.
   *
   * Only ever the number step. Telling somebody to "go and get a phone number"
   * when numbers are allocated by our team is worse than saying nothing — they
   * will look for a button that does not exist and conclude the product is
   * broken.
   */
  waiting?: boolean
}

/** Something that is stopping calls happening right now. */
export type Blocker = {
  key: "no-credit" | "agents-off" | "number-detached"
  severity: "danger" | "warning"
  title: string
  body: string
  href: string
  cta: string
}

export type Onboarding = {
  steps: SetupStep[]
  blockers: Blocker[]
  /** How many steps are done, and how many there are. */
  done: number
  total: number
  complete: boolean
  /** The first step that is not done, if any. */
  next: SetupStep | null
}

export async function loadOnboarding(tenant: TenantContext["tenant"]): Promise<Onboarding> {
  const [numberCount, agentCount, liveAgents, attached, callCount] = await Promise.all([
    prisma.phoneNumber.count({ where: { tenantId: tenant.id } }),
    prisma.agent.count({ where: { tenantId: tenant.id } }),
    prisma.agent.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
    // A number that points at an agent. `agentId: { not: null }` rather than a
    // count of numbers, because ten unattached numbers is still nothing
    // answering the phone.
    prisma.phoneNumber.count({ where: { tenantId: tenant.id, agentId: { not: null } } }),
    prisma.call.count({ where: { tenantId: tenant.id } }),
  ])

  const steps: SetupStep[] = [
    {
      key: "number",
      title: "Get a phone number",
      body: "Numbers are allocated to your workspace by the Hi-Astrix team. One appears here when it's ready — there's nothing for you to do.",
      href: "/dashboard/numbers",
      cta: "See your numbers",
      done: numberCount > 0,
      waiting: numberCount === 0,
    },
    {
      key: "agent",
      title: "Build an agent",
      body: "Start from a template — there are thirty-eight, including ones written for roofing, HVAC, clinics and property — then change the wording to suit you.",
      href: "/dashboard/agents/new",
      cta: "Create an agent",
      done: agentCount > 0,
    },
    {
      key: "attach",
      title: "Point a number at it",
      body: "Until a number is attached, nobody can reach your agent and it has no caller ID to ring out from.",
      href: "/dashboard/numbers",
      cta: "Attach a number",
      done: attached > 0,
    },
    {
      key: "call",
      title: "Make a test call",
      body: "Ring your own phone from the agent editor and listen to it. Thirty seconds of hearing it beats an hour of reading the instructions.",
      href: "/dashboard/agents",
      cta: "Test an agent",
      done: callCount > 0,
    },
  ]

  /* ── What is stopping calls right now ──────────────────────────────── */

  const cap = tenant.package?.minutesIncluded ?? 0
  const hasAllowance = cap > 0 && tenant.minutesUsed < cap
  const canPay = hasAllowance || tenant.creditBalanceCents > 0

  const blockers: Blocker[] = []

  /* Only worth saying once there is something to stop. A brand-new workspace
   * with no agents has an empty balance and is not "broken" — it has not
   * started, and the checklist is the right thing to show it. */
  const started = agentCount > 0

  if (started && !canPay) {
    blockers.push({
      key: "no-credit",
      severity: "danger",
      title: "Your agents can't take calls",
      body: cap > 0
        ? "You've used your included minutes and your balance is empty, so incoming calls aren't being answered and campaigns are paused."
        : "There's no balance on the account, so incoming calls aren't being answered and campaigns are paused.",
      href: "/dashboard/billing",
      cta: "Top up",
    })
  }

  if (started && canPay && liveAgents === 0) {
    blockers.push({
      key: "agents-off",
      severity: "warning",
      title: "Every agent is switched off",
      body: "Nothing is answering the phone. An agent that's switched off doesn't take calls even when its number is live.",
      href: "/dashboard/agents",
      cta: "Go to agents",
    })
  }

  if (started && canPay && liveAgents > 0 && numberCount > 0 && attached === 0) {
    blockers.push({
      key: "number-detached",
      severity: "warning",
      title: "No number points at an agent",
      body: "You have a number and a live agent, but they aren't connected — so calls to that number reach nothing.",
      href: "/dashboard/numbers",
      cta: "Attach it",
    })
  }

  const done = steps.filter(s => s.done).length

  return {
    steps,
    blockers,
    done,
    total: steps.length,
    complete: done === steps.length,
    // The first *actionable* step. Skipping past one they are waiting on us for
    // means the guidance never tells somebody to go and stare at an empty page.
    next: steps.find(s => !s.done && !s.waiting) ?? steps.find(s => !s.done) ?? null,
  }
}
