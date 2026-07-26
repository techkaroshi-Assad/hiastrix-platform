/**
 * Minutes and money, and the translation between them.
 *
 * A tenant thinks in minutes; we bill in dollars. Showing only one of the two
 * makes every billing screen a puzzle — "$1.30 left" tells nobody whether that
 * is an afternoon or a fortnight. So every figure carries both, and this module
 * owns the conversion so the pages cannot disagree about it.
 *
 * Client-safe: arithmetic only.
 */

export type Allowance = {
  /** Minutes the package covers at no cost. */
  includedMinutes: number
  /** Cost of a minute once the allowance is gone, in cents. */
  overageRateCents: number
  minutesUsed: number
  balanceCents: number
}

export type AllowanceView = {
  includedMinutes: number
  minutesUsed: number
  /** Package minutes still to burn through. */
  minutesRemaining: number
  /** Minutes already taken beyond the allowance. */
  overageMinutes: number
  overageRateCents: number
  balanceCents: number
  /** What the balance is worth in minutes, once the allowance is gone. */
  balanceMinutes: number
  /** Everything they can still use: allowance left plus what credit buys. */
  totalMinutesLeft: number
  /** How far through the allowance, for a progress bar. 0 with no package. */
  usedPct: number
  /**
   * Whether calls actually connect.
   *
   * NOT simply "balance above zero". A tenant who has just bought a package sits
   * at full allowance and zero credit, and metering never charges them a penny
   * until they exceed it — so telling them calls are paused would be false, and
   * pausing their agents on that basis would be a bug.
   */
  canCall: boolean
  /** Set when calls are genuinely stopped, phrased for the tenant. */
  stoppedReason: string | null
}

/** Whole minutes a balance buys at a given rate. Zero rate means unmetered. */
export function minutesFor(cents: number, rateCents: number): number {
  if (rateCents <= 0 || cents <= 0) return 0
  return Math.floor(cents / rateCents)
}

export function readAllowance(a: Allowance): AllowanceView {
  const includedMinutes  = Math.max(0, a.includedMinutes)
  const minutesUsed      = Math.max(0, a.minutesUsed)
  const overageRateCents = Math.max(0, a.overageRateCents)
  const balanceCents     = a.balanceCents

  const minutesRemaining = Math.max(0, includedMinutes - minutesUsed)
  const overageMinutes   = Math.max(0, minutesUsed - includedMinutes)
  const balanceMinutes   = minutesFor(balanceCents, overageRateCents)

  const canCall = minutesRemaining > 0 || balanceCents > 0

  return {
    includedMinutes,
    minutesUsed,
    minutesRemaining,
    overageMinutes,
    overageRateCents,
    balanceCents,
    balanceMinutes,
    totalMinutesLeft: minutesRemaining + balanceMinutes,
    usedPct: includedMinutes > 0
      ? Math.min(100, Math.round((minutesUsed / includedMinutes) * 100))
      : 0,
    canCall,
    stoppedReason: canCall
      ? null
      : includedMinutes > 0
        ? "You've used your whole allowance and your balance is empty, so calls are paused."
        : "Your balance is empty, so calls are paused.",
  }
}

/** "1,000 minutes" — the unit spelled out, since these appear beside dollars. */
export const minutesLabel = (n: number) =>
  `${n.toLocaleString()} ${n === 1 ? "minute" : "minutes"}`
