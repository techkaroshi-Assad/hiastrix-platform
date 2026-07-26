"use client"

/**
 * Top-up control. Hands off to Stripe Checkout — no card details ever touch
 * this application, and the response carries nothing but a redirect URL.
 */

import { useState } from "react"
import { SubmitButton, ErrorNote } from "@/components/ui/field"
import { SecondaryButton } from "@/components/ui/form"
import { usd } from "@/lib/format"
import { minutesFor, minutesLabel } from "@/lib/billing/allowance"
import { cn } from "@/lib/utils"

const PRESETS = [2500, 5000, 10000, 25000]

export function TopUp({
  enabled,
  rateCents,
}: {
  enabled: boolean
  /** Their overage rate, so an amount can be shown in minutes as well as
   *  dollars. Zero when they have no plan, in which case we only show money —
   *  inventing a conversion would be worse than omitting one. */
  rateCents: number
}) {
  const [amount, setAmount] = useState<number>(5000)
  const [custom, setCustom] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effective = custom ? Math.round(Number(custom) * 100) : amount
  const valid = Number.isFinite(effective) && effective >= 500 && effective <= 500000
  const buysMinutes = valid && rateCents > 0 ? minutesFor(effective, rateCents) : 0

  async function go() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: effective }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      window.location.href = body.url
    } catch {
      setError("Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 px-5 py-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <SecondaryButton
            key={p}
            type="button"
            onClick={() => {
              setAmount(p)
              setCustom("")
            }}
            className={cn(
              !custom && amount === p && "border-brand-500/60 bg-brand-500/12 text-brand-200"
            )}
          >
            {usd(p)}
          </SecondaryButton>
        ))}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="custom-topup"
          className="block text-xs font-medium tracking-[0.01em] text-muted"
        >
          Or enter a custom amount (USD)
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-subtle">
            $
          </span>
          <input
            id="custom-topup"
            type="number"
            min={5}
            max={5000}
            step="1"
            inputMode="decimal"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            placeholder="100"
            className="h-11 w-full rounded-field border border-line-strong bg-field pl-7 pr-3.5 text-sm text-fg outline-none transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-500/65"
          />
        </div>
      </div>

      <SubmitButton
        type="button"
        onClick={go}
        loading={busy}
        disabled={!enabled || !valid}
        sheen={false}
      >
        {enabled ? `Top up ${valid ? usd(effective) : ""}` : "Payments unavailable"}
      </SubmitButton>

      {/* What the money actually buys. A number of dollars is not something a
          caller-facing business can plan around; a number of minutes is. */}
      {enabled && buysMinutes > 0 && (
        <p className="text-xs leading-relaxed text-subtle">
          That&rsquo;s about {minutesLabel(buysMinutes)} of calling beyond your
          included allowance, at {usd(rateCents)} a minute.
        </p>
      )}

      <p className="text-xs leading-relaxed text-subtle">
        You&rsquo;ll be taken to our secure payment page to complete the top-up. Your
        balance updates automatically once the payment clears, and any paused agents
        resume straight away.
      </p>
    </div>
  )
}
