"use client"

/**
 * Plan selection.
 *
 * Every plan states its price *and* what that buys in minutes, because a tenant
 * reasons in minutes and we charge in dollars. A card showing only "$200" makes
 * them do arithmetic we already know the answer to.
 *
 * Buying assigns nothing on its own — the webhook does that once the payment
 * settles. Reaching the success page is not evidence anyone paid.
 */

import { useState } from "react"
import { SecondaryButton } from "@/components/ui/form"
import { SubmitButton, ErrorNote } from "@/components/ui/field"
import { usd } from "@/lib/format"
import { minutesLabel } from "@/lib/billing/allowance"
import { cn } from "@/lib/utils"

export type Plan = {
  id: string
  name: string
  minutesIncluded: number
  priceCents: number
  overageRateCents: number
}

export function Plans({
  plans,
  currentId,
  enabled,
}: {
  plans: Plan[]
  currentId: string | null
  /** False when payments aren't configured, or the workspace can't transact. */
  enabled: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(planId: string) {
    setError(null)
    setBusy(planId)
    try {
      const res = await fetch("/api/billing/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: planId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      window.location.href = body.url
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  if (plans.length === 0) {
    return (
      <div className="px-5 py-5">
        <p className="text-[13px] text-subtle">
          No plans are available yet. Your balance still covers calls at your
          current rate.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 px-5 py-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map(plan => {
          const current = plan.id === currentId
          return (
            <div
              key={plan.id}
              className={cn(
                "flex flex-col rounded-field border p-4 transition-colors",
                current ? "border-brand-500/60 bg-brand-500/[0.07]" : "border-line bg-field-soft"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13.5px] font-semibold">{plan.name}</span>
                {current && (
                  <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] text-brand-on-tint">
                    Current
                  </span>
                )}
              </div>

              {/* Money and minutes together, always. */}
              <div className="mt-3">
                <div className="text-[24px] font-semibold tracking-[-0.025em]">
                  {usd(plan.priceCents)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {minutesLabel(plan.minutesIncluded)} included
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-subtle">
                {usd(plan.overageRateCents)} a minute after that, taken from your
                balance.
              </p>

              <div className="mt-4 pt-1">
                {enabled ? (
                  <SubmitButton
                    type="button"
                    loading={busy === plan.id}
                    disabled={Boolean(busy)}
                    sheen={false}
                    className="w-full"
                    onClick={() => choose(plan.id)}
                  >
                    {current ? "Renew" : currentId ? "Switch to this" : "Choose"}
                  </SubmitButton>
                ) : (
                  <SecondaryButton type="button" disabled className="w-full justify-center">
                    Unavailable
                  </SecondaryButton>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs leading-relaxed text-subtle">
        Buying a plan starts your minutes again from zero. Included minutes cost
        nothing to use — your balance is only touched once they run out.
      </p>
    </div>
  )
}
