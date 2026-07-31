"use client"

/**
 * Managing the monthly plan: renewal date, cancel, resume, change card.
 *
 * Built here rather than handing the tenant to Stripe's hosted billing portal.
 * The portal is one link and would have been an afternoon's less work, but it
 * is a Stripe-branded page listing Stripe's own idea of the plans, and this is
 * a white-label platform — a customer of Hi-Astrix should not be sent to
 * another company's interface to manage something they bought from us. Cancel
 * and resume are two API calls. The only part genuinely worth handing over is
 * card entry, and that goes to the same checkout page they already used to pay.
 *
 * Cancelling asks first, and says what actually happens, because "cancel" is
 * the one button on this page nobody wants to press twice.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SecondaryButton, DangerButton, Panel } from "@/components/ui/form"
import { SubmitButton } from "@/components/ui/field"

export function SubscriptionControls({
  cancelAtPeriodEnd,
  periodEndLabel,
  canManage,
}: {
  cancelAtPeriodEnd: boolean
  /** Already formatted server-side, so this component never formats a date and
   *  the page and the card can never disagree about the wording. */
  periodEndLabel: string | null
  /** False when payments aren't configured or there is no live subscription. */
  canManage: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function act(action: "cancel" | "resume" | "update_card") {
    setError(null)
    setBusy(action)
    try {
      const res = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }

      if (body.url) {
        window.location.href = body.url
        return
      }

      setConfirming(false)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SecondaryButton
          type="button"
          onClick={() => act("update_card")}
          disabled={busy !== null}
        >
          {busy === "update_card" ? "Opening…" : "Change card"}
        </SecondaryButton>

        {canManage &&
          (cancelAtPeriodEnd ? (
            <SubmitButton
              type="button"
              sheen={false}
              className="w-auto px-5"
              loading={busy === "resume"}
              disabled={busy !== null}
              onClick={() => act("resume")}
            >
              Keep my plan
            </SubmitButton>
          ) : (
            <SecondaryButton
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy !== null}
            >
              Cancel plan
            </SecondaryButton>
          ))}
      </div>

      {error && (
        <span className="max-w-[380px] text-right text-[11.5px] text-danger">{error}</span>
      )}

      <Panel
        open={confirming}
        title="Cancel your plan?"
        onClose={() => setConfirming(false)}
        footer={
          <div className="flex items-center justify-end gap-2">
            <SecondaryButton
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
            >
              Keep my plan
            </SecondaryButton>
            <DangerButton
              type="button"
              onClick={() => act("cancel")}
              disabled={busy !== null}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel at period end"}
            </DangerButton>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">
            {periodEndLabel ? (
              <>
                You keep every included minute until{" "}
                <strong className="text-fg">{periodEndLabel}</strong> — the month
                you&rsquo;ve already paid for runs its course. Nothing is charged
                after that.
              </>
            ) : (
              <>
                You keep every included minute until the end of the month
                you&rsquo;ve already paid for. Nothing is charged after that.
              </>
            )}
          </p>
          <p className="text-[13px] leading-relaxed text-muted">
            Your agents, numbers, campaigns and contacts all stay exactly as they
            are, and any remaining balance still pays for calls at your
            per-minute rate. You can start a plan again whenever you like.
          </p>
        </div>
      </Panel>
    </div>
  )
}
