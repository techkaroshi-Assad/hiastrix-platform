/**
 * "May this tenant place a call right now?" — asked in one place.
 *
 * There were three answers to this question in the codebase and they disagreed.
 * Two of them, in the test-call and browser-call routes, read:
 *
 *     if (creditBalanceCents <= 0 && ctx.tenant.package) { …refuse… }
 *
 * which lets a tenant with **no package and no balance** call as much as they
 * like — while `processCallEnded` bills them for every minute at the platform
 * rate. The third, in `cap-enforcement`, pauses on raw `creditBalanceCents <= 0`,
 * which takes a tenant who has just bought a plan and spent nothing off the air
 * because their credit balance is legitimately zero.
 *
 * The correct predicate already existed — `readAllowance(...).canCall` — and the
 * admin tenant route was the only caller using it. This module makes it the only
 * way to ask, because an outbound dialer that reads the question wrong either
 * gives calls away or stops a paying customer mid-campaign.
 *
 * Server-only. The arithmetic itself lives in `allowance.ts`, which stays
 * client-safe so billing pages can render the same numbers.
 */

import { prisma } from "@/lib/prisma"
import { readAllowance, type AllowanceView } from "@/lib/billing/allowance"

/** Used when a tenant has no package and no platform settings row exists. */
const FALLBACK_RATE_CENTS = 35

/** The shape every caller already has to hand — `getTenantContext().tenant`. */
export type BillableTenant = {
  status: string
  minutesUsed: number
  creditBalanceCents: number
  package: { minutesIncluded: number; overageRateCents: number } | null
}

export type CallVerdict = {
  ok: boolean
  /**
   * Why not, when not. Distinct from the message because the two refusals carry
   * different HTTP statuses and mean different things to the person reading:
   * one is "your account isn't open", the other is "you're out of money".
   */
  reason: "suspended" | "no_balance" | null
  allowance: AllowanceView
}

/**
 * Pure form — no database access, for callers that already loaded the tenant.
 *
 * Suspension is checked first and separately. A blocked tenant with a full
 * allowance still may not call, and telling them to top up would be both wrong
 * and insulting.
 */
export function verdictFor(
  tenant: BillableTenant,
  fallbackRateCents = FALLBACK_RATE_CENTS
): CallVerdict {
  const allowance = readAllowance({
    includedMinutes:  tenant.package?.minutesIncluded ?? 0,
    overageRateCents: tenant.package?.overageRateCents ?? fallbackRateCents,
    minutesUsed:      tenant.minutesUsed,
    balanceCents:     tenant.creditBalanceCents,
  })

  if (tenant.status !== "ACTIVE") {
    return { ok: false, reason: "suspended", allowance }
  }
  if (!allowance.canCall) {
    return { ok: false, reason: "no_balance", allowance }
  }
  return { ok: true, reason: null, allowance }
}

/**
 * Loading form — for background work that has a tenant id and no session.
 *
 * The dialer cannot use `getTenantContext()`: there is no signed-in user behind
 * a cron tick. This is the equivalent, and it reads the platform's overage rate
 * so a package-less tenant's remaining balance converts to minutes correctly.
 */
export async function tenantCanCall(tenantId: string): Promise<CallVerdict> {
  const [tenant, settings] = await Promise.all([
    prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        status:             true,
        minutesUsed:        true,
        creditBalanceCents: true,
        package: { select: { minutesIncluded: true, overageRateCents: true } },
      },
    }),
    prisma.platformSettings.findUnique({ where: { id: true } }),
  ])

  if (!tenant) {
    return {
      ok: false,
      reason: "suspended",
      allowance: readAllowance({
        includedMinutes: 0, overageRateCents: 0, minutesUsed: 0, balanceCents: 0,
      }),
    }
  }

  return verdictFor(tenant, settings?.overageRateCents ?? FALLBACK_RATE_CENTS)
}
