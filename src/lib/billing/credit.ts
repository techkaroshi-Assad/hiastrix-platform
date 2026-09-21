/**
 * Where the balance came from.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * `tenant.creditBalanceCents` is one number, and every billing screen treated
 * it as one thing: money the tenant put in. For Kaizen that was flatly untrue.
 * Their ledger, in full:
 *
 *   MANUAL_CREDIT    4 entries   +$130.00   allocated by us, from super admin
 *   CALL_DEDUCTION 174 entries    −$76.65   pay-as-you-go, before the plan
 *   OVERAGE_CHARGE  48 entries    −$29.40   charged in error
 *   REFUND           1 entry      +$29.40   that error, corrected
 *   ─────────────────────────────────────
 *   balance                       $53.35   — and TOP_UP has never fired once
 *
 * They have never paid us a penny. The page told them they had "$53.35 of
 * balance" worth "152 minutes at your overage rate", as though they were a
 * paying customer running down their own money, and the four cards said
 * nothing about a plan being granted rather than bought.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 *
 * Do not attribute spend to a source. Spending draws on one pooled balance,
 * so deciding whether a given call burned granted credit or purchased credit
 * is an arbitrary accounting choice dressed up as a fact, and any such choice
 * eventually disagrees with the ledger.
 *
 * Instead this states the account: what came in, from where, what went out,
 * and on what. Every figure is a straight sum over ledger rows, so it
 * reconciles to the balance by construction in every scenario — plan or no
 * plan, granted or purchased or both, overage or none, refunded or not. That
 * is what "accurate in any scenario" has to mean; anything cleverer is a
 * number somebody will one day have to defend and cannot.
 *
 * Client-safe: arithmetic over rows the caller has already loaded.
 */

/** The ledger vocabulary, as `LedgerEntryType` in the schema. */
export type LedgerType =
  | "PACKAGE_PURCHASE"
  | "TOP_UP"
  | "CALL_DEDUCTION"
  | "OVERAGE_CHARGE"
  | "MANUAL_CREDIT"
  | "MANUAL_DEDUCTION"
  | "REFUND"
  | "CHARGEBACK"

export type LedgerRow = { type: LedgerType | string; amountCents: number }

export type CreditComposition = {
  /** Credit an operator allocated from super admin. Never paid for. */
  grantedCents: number
  /** Credit the tenant actually bought — top-ups and package purchases. */
  purchasedCents: number
  /** Refunds and chargebacks put back. */
  refundedCents: number
  /** Spent on calls: pay-as-you-go deductions plus overage charges. */
  spentCents: number
  /** Manual deductions by an operator — corrections, clawbacks. */
  adjustedCents: number
  /** Everything above, netted. Should equal tenant.creditBalanceCents. */
  netCents: number
  /** True when nothing was ever bought, so the balance is entirely ours. */
  fullyGranted: boolean
  /** True when there is no ledger at all — say nothing rather than "$0". */
  empty: boolean
}

const CREDITS_IN: Record<string, keyof CreditComposition | undefined> = {
  MANUAL_CREDIT:    "grantedCents",
  TOP_UP:           "purchasedCents",
  PACKAGE_PURCHASE: "purchasedCents",
  REFUND:           "refundedCents",
}

export function creditComposition(rows: LedgerRow[]): CreditComposition {
  let grantedCents = 0
  let purchasedCents = 0
  let refundedCents = 0
  let spentCents = 0
  let adjustedCents = 0
  let netCents = 0

  for (const r of rows) {
    const cents = Math.round(r.amountCents)
    netCents += cents

    const bucket = CREDITS_IN[r.type]
    if (bucket === "grantedCents")        grantedCents   += cents
    else if (bucket === "purchasedCents") purchasedCents += cents
    else if (bucket === "refundedCents")  refundedCents  += cents
    else if (r.type === "CALL_DEDUCTION" || r.type === "OVERAGE_CHARGE") spentCents += -cents
    else if (r.type === "MANUAL_DEDUCTION" || r.type === "CHARGEBACK")   adjustedCents += -cents
  }

  return {
    grantedCents,
    purchasedCents,
    refundedCents,
    spentCents,
    adjustedCents,
    netCents,
    // A refund of something we granted is still not money they paid, so the
    // test is purchases alone.
    fullyGranted: purchasedCents === 0 && grantedCents > 0,
    empty: rows.length === 0,
  }
}

/**
 * How to describe the balance in one phrase, given where it came from.
 *
 * Used wherever a figure would otherwise read as "your money". Saying
 * "credit we've allocated to you" to a tenant who was granted it is the
 * difference between an honest screen and a misleading one.
 */
export function balanceLabel(c: CreditComposition): string {
  if (c.empty) return "Balance"
  if (c.fullyGranted) return "Credit allocated to you"
  if (c.grantedCents > 0 && c.purchasedCents > 0) return "Balance (purchased + allocated)"
  return "Balance"
}
