"use client"

/**
 * Plan selection.
 *
 * Every plan states its price *and* what that buys in minutes, because a tenant
 * reasons in minutes and we charge in dollars. A card showing only "$200" makes
 * them do arithmetic we already know the answer to.
 *
 * Two different things happen behind one button. Somebody with no plan is sent
 * to checkout to enter a card. Somebody already subscribed is switched in
 * place — no checkout, no card re-entry, no leaving the app to authorise
 * something they have already authorised. The endpoint decides which, and
 * answers with either a URL to follow or a plain acknowledgement.
 *
 * Neither path assigns anything on its own. The webhook does that once the
 * money has actually moved.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
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
  subscribed,
  enabled,
}: {
  plans: Plan[]
  currentId: string | null
  /** Whether a live subscription is paying for the current plan, which decides
   *  whether choosing another one is a purchase or a switch. */
  subscribed: boolean
  /** False when payments aren't configured, or the workspace can't transact. */
  enabled: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function choose(planId: string) {
    setError(null)
    setBusy(planId)
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: planId }),
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        setBusy(null)
        return
      }

      // Switched in place — nothing to redirect to, so re-read the page.
      if (body.switched) {
        startTransition(() => router.refresh())
        setBusy(null)
        return
      }

      if (!body.url) {
        setError("Something went wrong. Please try again.")
        setBusy(null)
        return
      }

      window.location.href = body.url
    } catch {
      setError("Something went wrong. Please try again.")
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

              {/* Money and minutes together, always — and the period, because
                  "$200" and "$200 a month" are very different offers. */}
              <div className="mt-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-[24px] font-semibold tracking-[-0.025em]">
                    {usd(plan.priceCents)}
                  </span>
                  <span className="text-[13px] text-muted">/ month</span>
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {minutesLabel(plan.minutesIncluded)} included every month
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-subtle">
                {usd(plan.overageRateCents)} a minute after that, taken from your
                balance.
              </p>

              <div className="mt-4 pt-1">
                {!enabled ? (
                  <SecondaryButton type="button" disabled className="w-full justify-center">
                    Unavailable
                  </SecondaryButton>
                ) : current && subscribed ? (
                  <SecondaryButton type="button" disabled className="w-full justify-center">
                    Your plan
                  </SecondaryButton>
                ) : (
                  <SubmitButton
                    type="button"
                    loading={busy === plan.id || pending}
                    disabled={Boolean(busy) || pending}
                    sheen={false}
                    className="w-full"
                    onClick={() => choose(plan.id)}
                  >
                    {subscribed ? "Switch to this" : "Choose"}
                  </SubmitButton>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs leading-relaxed text-subtle">
        {subscribed ? (
          <>
            Switching takes effect immediately. We&rsquo;ll charge or credit the
            difference for the rest of this month, and your minutes carry on from
            where they are rather than starting again — so upgrading mid-month
            gives you the bigger allowance straight away.
          </>
        ) : (
          <>
            Plans renew monthly and your minutes start again from zero on each
            renewal. Included minutes cost nothing to use; your balance is only
            touched once they run out. Cancel whenever you like — you keep the
            month you&rsquo;ve paid for.
          </>
        )}
      </p>
    </div>
  )
}
