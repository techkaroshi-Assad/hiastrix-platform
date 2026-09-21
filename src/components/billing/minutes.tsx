/**
 * The minutes breakdown — one component, both pages.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Billing and Analytics were each doing their own minutes arithmetic, and a
 * tenant reading both at once saw four numbers that looked like they
 * contradicted each other:
 *
 *   Billing card     "766 used · 85% of this month · 134 minutes left"
 *   Plans header     "286 minutes left in total"
 *   Analytics        "985 minutes" over the last 30 days
 *   Analytics        "$76.65 charged in total"  next to  Billing "Within allowance"
 *
 * Every one of those figures was arithmetically correct. They disagreed because
 * three different things were all being called "minutes left" or "charged" with
 * nothing on screen saying which was which:
 *
 *   134  what is left of the package allowance this billing month
 *   286  that 134 PLUS the minutes the credit balance would buy at the overage
 *        rate — a different kind of minute, only reachable after the first 134
 *        are gone
 *   985  minutes used in a rolling 30-day window, which is not the billing
 *        month and reaches back before the plan started
 *
 * So this component shows the arithmetic instead of the conclusion. Included,
 * used, left, beyond-the-allowance and what the balance buys are separate rows
 * with their own labels, and the total is shown as a sum of its parts rather
 * than as a single number the reader has to take on trust.
 *
 * `windowMinutes` is the reconciling footnote: when a page is measuring a
 * rolling window rather than the billing month, it says so and gives both
 * figures, because "why does Analytics say 985 and Billing say 766" is the
 * question this whole file was written to stop.
 *
 * Server-safe: presentation only, no data access. Everything comes from
 * readAllowance(), so the two pages cannot drift apart again.
 */

import { Card } from "@/components/app/table"
import { usd } from "@/lib/format"
import { minutesLabel, type AllowanceView } from "@/lib/billing/allowance"
import type { CreditComposition } from "@/lib/billing/credit"

function Row({
  label,
  hint,
  value,
  tone = "normal",
  rule,
}: {
  label: string
  hint?: string
  value: string
  tone?: "normal" | "muted" | "total" | "warning"
  /** Draws a divider above, for the rows that are a subtotal. */
  rule?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2.5 ${
        rule ? "border-t border-line" : "border-b border-line-soft last:border-b-0"
      }`}
    >
      <div className="min-w-0">
        <span
          className={
            tone === "total"
              ? "text-[13px] font-medium"
              : tone === "muted"
                ? "text-[12.5px] text-subtle"
                : "text-[12.5px] text-muted"
          }
        >
          {label}
        </span>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-subtle">{hint}</div>}
      </div>
      <span
        className={`shrink-0 tabular-nums ${
          tone === "total"
            ? "text-[14px] font-semibold"
            : tone === "warning"
              ? "text-[13px] text-warning"
              : tone === "muted"
                ? "text-[13px] text-subtle"
                : "text-[13px]"
        }`}
      >
        {value}
      </span>
    </div>
  )
}

export function MinutesBreakdown({
  a,
  /**
   * Where the balance came from, when the page has loaded the ledger.
   *
   * Without it this card can only say "your balance", which for a tenant
   * running entirely on credit we allocated is not true. See lib/billing/credit.ts.
   */
  credit,
  /** Minutes used in the page's own window, when that isn't the billing month. */
  windowMinutes,
  /** Length of that window, in days. */
  windowDays,
  /** Charged to the balance in that window, if the page tracks money. */
  windowChargedCents,
  className,
}: {
  a: AllowanceView
  credit?: CreditComposition
  windowMinutes?: number
  windowDays?: number
  windowChargedCents?: number
  className?: string
}) {
  const hasPlan = a.includedMinutes > 0
  const granted = credit?.fullyGranted ?? false
  /** "your balance" is a claim about whose money it is. Only make it when true. */
  const balanceWord = granted ? "the credit allocated to you" : "your balance"

  return (
    <Card title="Minutes" className={className}>
      <div className="px-5 py-1">
        {hasPlan ? (
          <>
            <Row
              label="Included in your plan"
              hint="Resets at the start of each billing month"
              value={a.includedMinutes.toLocaleString()}
            />
            <Row
              label="Used this billing month"
              value={`−${Math.min(a.minutesUsed, a.includedMinutes).toLocaleString()}`}
              tone="muted"
            />
            <Row
              label="Included minutes left"
              value={a.minutesRemaining.toLocaleString()}
              tone="total"
              rule
            />

            <div className="h-3" />

            <Row
              label="Beyond the allowance"
              hint={
                a.overageMinutes > 0
                  ? `Charged at ${usd(a.overageRateCents)} a minute`
                  : "Nothing has been charged beyond your plan"
              }
              value={
                a.overageMinutes > 0
                  ? `${a.overageMinutes.toLocaleString()} min · ${usd(a.overageCents)}`
                  : "None"
              }
              tone={a.overageMinutes > 0 ? "warning" : "muted"}
            />
            <Row
              label={granted ? "What your allocated credit would buy" : "What your balance would buy"}
              hint={
                a.overageRateCents > 0
                  ? `${usd(a.balanceCents)} at ${usd(a.overageRateCents)} a minute — only used once the included minutes are gone`
                  : "No overage rate set on this plan"
              }
              value={a.balanceMinutes > 0 ? `+${a.balanceMinutes.toLocaleString()}` : "—"}
              tone="muted"
            />
            <Row
              label="Total you can still use"
              value={a.totalMinutesLeft.toLocaleString()}
              tone="total"
              rule
            />
          </>
        ) : (
          <>
            <Row
              label="Included in your plan"
              hint="You're on pay-as-you-go — every minute comes out of your balance"
              value="None"
              tone="muted"
            />
            <Row
              label="Balance"
              hint={
                a.overageRateCents > 0
                  ? `at ${usd(a.overageRateCents)} a minute`
                  : undefined
              }
              value={usd(a.balanceCents)}
            />
            <Row
              label="Minutes that buys"
              value={a.balanceMinutes.toLocaleString()}
              tone="total"
              rule
            />
          </>
        )}
      </div>

      {/*
       * Where the credit came from.
       *
       * Stated as a sum over the ledger rather than as an attribution: which
       * dollars a given call burned is an accounting choice, not a fact, and
       * any choice eventually disagrees with the balance. These figures
       * reconcile by construction, whatever the tenant's arrangement.
       */}
      {credit && !credit.empty && (
        <div className="border-t border-line px-5 py-1">
          <div className="pt-2 pb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-subtle">
            Where this credit came from
          </div>
          {credit.grantedCents > 0 && (
            <Row
              label="Allocated by Hi-Astrix"
              hint="Credit we added to this account — not billed to you"
              value={`+${usd(credit.grantedCents)}`}
            />
          )}
          {credit.purchasedCents > 0 && (
            <Row label="Paid by you" value={`+${usd(credit.purchasedCents)}`} />
          )}
          {credit.refundedCents > 0 && (
            <Row label="Refunded back" value={`+${usd(credit.refundedCents)}`} tone="muted" />
          )}
          {credit.spentCents > 0 && (
            <Row
              label="Used on calls"
              hint={hasPlan ? "Charged before your current plan started, or beyond its allowance" : undefined}
              value={`−${usd(credit.spentCents)}`}
              tone="muted"
            />
          )}
          {credit.adjustedCents > 0 && (
            <Row label="Adjustments" value={`−${usd(credit.adjustedCents)}`} tone="muted" />
          )}
          <Row
            label={granted ? "Credit remaining" : "Balance now"}
            value={usd(credit.netCents)}
            tone="total"
            rule
          />
          {granted && (
            <p className="px-0 pb-4 pt-3 text-[12px] leading-relaxed text-subtle">
              This account has never been charged. Everything above was allocated
              by Hi-Astrix, so {balanceWord} is not money you have paid in.
            </p>
          )}
        </div>
      )}

      {/*
       * The reconciling footnote.
       *
       * Without it, a tenant comparing this card to the figure at the top of
       * Analytics reasonably concludes one of them is broken. Neither is —
       * they measure different periods — so the fix is to say the two numbers
       * out loud together rather than to hide one of them.
       */}
      {typeof windowMinutes === "number" && typeof windowDays === "number" && (
        <div className="border-t border-line px-5 py-4">
          <p className="text-[12px] leading-relaxed text-subtle">
            Everything above is your <strong className="font-medium text-muted">billing month</strong>.
            The rest of this page measures the{" "}
            <strong className="font-medium text-muted">last {windowDays} days</strong>, which is a
            different stretch of time — so the two sets of figures are not meant to match.
            Your agents used {minutesLabel(windowMinutes)} in that window
            {hasPlan && ` against ${minutesLabel(a.minutesUsed)} counted toward this month's allowance`}.
            {typeof windowChargedCents === "number" && windowChargedCents > 0 && (
              <>
                {" "}
                {usd(windowChargedCents)} was charged to your balance during it
                {hasPlan && a.overageCents === 0
                  ? " — from before your current plan started, not from going over it"
                  : ""}
                .
              </>
            )}
          </p>
        </div>
      )}
    </Card>
  )
}
