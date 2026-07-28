/**
 * What happened on a dial, and when to try again.
 *
 * Pure arithmetic and string matching — no database, no provider, no clock of
 * its own. Everything time-dependent is passed in, so the whole state machine is
 * testable without waiting for anything.
 *
 * ── WHY THIS DOES NOT REUSE THE WEBHOOK'S `mapStatus` ──────────────────
 *
 * `api/webhooks/vapi/route.ts` maps an unrecognised `endedReason` to COMPLETED.
 * For the call log that is a reasonable default — the call happened, we just
 * can't say more. For a dialer it is the worst possible default: a lead nobody
 * ever spoke to gets marked as contacted and is never called again. The
 * vocabulary shifts over time, so unknown reasons are not hypothetical.
 *
 * This classifier defaults the other way, to PROVIDER_ERROR, which spends the
 * fault budget rather than the lead's attempts. What makes that safe is the
 * duration override below.
 */

export type Outcome =
  | "CONNECTED"
  | "VOICEMAIL"
  | "NO_ANSWER"
  | "BUSY"
  | "INVALID_NUMBER"
  | "REJECTED"
  | "PROVIDER_ERROR"
  | "CANCELLED"

export type LeadState =
  | "PENDING"
  | "RETRY_WAIT"
  | "DEFERRED"
  | "DIALING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "EXHAUSTED"
  | "FAILED"
  | "SUPPRESSED"
  | "CANCELLED"

export type VoicemailPolicy = "LEAVE_MESSAGE" | "HANG_UP_RETRY" | "HANG_UP_DONE"

/**
 * Audio long enough that a person heard something.
 *
 * This is the rule that makes an unknown-vocabulary default safe: whatever the
 * reason string says, ten seconds of call means the lead was reached. Without
 * it, one renamed error code would send every connected call back into the
 * retry queue.
 */
const CONNECTED_SECONDS = 10

const has = (s: string, ...needles: string[]) => needles.some(n => s.includes(n))

export function classifyOutcome(a: {
  endedReason: string | null
  durationSeconds: number
}): Outcome {
  const r = (a.endedReason ?? "").toLowerCase()
  const d = Math.max(0, a.durationSeconds)

  // Stopped by us, before anything happened. Checked first, and only while the
  // call was short — an operator cancelling a conversation already in progress
  // still means the lead was reached.
  if (d < CONNECTED_SECONDS && has(r, "manually-canceled", "manually-cancelled")) {
    return "CANCELLED"
  }

  // Voicemail before the duration override, because a voicemail is *long* and
  // would otherwise be swallowed by it.
  if (has(r, "voicemail", "answering-machine", "machine-detected")) return "VOICEMAIL"

  if (d >= CONNECTED_SECONDS) return "CONNECTED"

  if (has(r, "customer-did-not-answer", "no-answer", "noanswer", "silence-timed-out")) {
    return "NO_ANSWER"
  }
  if (has(r, "customer-busy", "busy")) return "BUSY"

  if (has(r, "invalid-phone", "invalid-destination", "invalid-number", "unallocated",
             "not-in-service", "21211", "21214", "13224")) {
    return "INVALID_NUMBER"
  }
  if (has(r, "rejected", "blocked", "blacklist", "do-not-call", "forbidden")) {
    return "REJECTED"
  }

  // Short calls that ended by an explicit hang-up. Under ten seconds this is
  // someone picking up and putting the phone down, which is contact.
  if (has(r, "customer-ended-call", "assistant-ended-call",
             "assistant-said-end-call-phrase", "assistant-forwarded-call",
             "exceeded-max-duration")) {
    return "CONNECTED"
  }

  // Everything else — including anything we have never seen. Provider fault
  // families are broad and keep changing, so they are the default rather than a
  // list to keep up to date.
  return "PROVIDER_ERROR"
}

/* ── Backoff ───────────────────────────────────────────────────────────── */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Curves are indexed by the attempt that just failed: [after 1st, 2nd, 3rd…]. */
const BACKOFF: Record<string, number[]> = {
  // Nobody home. Try again this afternoon, then tomorrow.
  NO_ANSWER: [20 * MINUTE, 2 * HOUR, 20 * HOUR],
  // Busy means a human is demonstrably there, right now — the most valuable
  // signal in the queue. It gets a much shorter curve than no-answer, though it
  // spends the same attempt budget.
  BUSY: [5 * MINUTE, 15 * MINUTE, 45 * MINUTE],
  // A machine picked up. Later today, then tomorrow.
  VOICEMAIL: [4 * HOUR, 20 * HOUR],
  // Our side or the provider's. Fast, because it is probably transient.
  PROVIDER_ERROR: [MINUTE, 5 * MINUTE, 15 * MINUTE],
}

/** Faults tolerated before a lead is given up on. Separate from maxAttempts. */
export const MAX_FAULTS = 3

/**
 * Spread retries out.
 *
 * Not decoration. Without it, a provider outage at T sends every lead on the
 * platform back to the queue with the same delay, and they all retry at T+60s
 * together — reproducing the outage we were backing off from.
 */
function jitter(ms: number, random: () => number): number {
  return Math.round(ms * (0.85 + random() * 0.3))
}

export type Transition = {
  state: LeadState
  /** Null for terminal states. */
  nextAttemptAt: Date | null
  /**
   * False when the attempt should be given back — a provider fault, or work
   * abandoned before the call was placed. The caller decrements `attemptNo`.
   */
  consumesAttempt: boolean
  /** Written to the lead, and shown to the tenant as-is. */
  note: string
}

export function scheduleNext(a: {
  outcome: Outcome
  /** The attempt that just finished, 1-based. */
  attemptNo: number
  faultNo: number
  maxAttempts: number
  voicemailPolicy: VoicemailPolicy
  now: Date
  random?: () => number
}): Transition {
  const random = a.random ?? Math.random
  const at = (ms: number) => new Date(a.now.getTime() + jitter(ms, random))

  const retry = (kind: keyof typeof BACKOFF, note: string): Transition => {
    const curve = BACKOFF[kind]
    const delay = curve[Math.min(a.attemptNo - 1, curve.length - 1)]
    return { state: "RETRY_WAIT", nextAttemptAt: at(delay), consumesAttempt: true, note }
  }

  const spent = a.attemptNo >= a.maxAttempts

  switch (a.outcome) {
    case "CONNECTED":
      return { state: "COMPLETED", nextAttemptAt: null, consumesAttempt: true, note: "Spoke to them." }

    case "NO_ANSWER":
      return spent
        ? { state: "EXHAUSTED", nextAttemptAt: null, consumesAttempt: true,
            note: `No answer after ${a.maxAttempts} attempts.` }
        : retry("NO_ANSWER", "No answer — will try again later.")

    case "BUSY":
      return spent
        ? { state: "EXHAUSTED", nextAttemptAt: null, consumesAttempt: true,
            note: `Line busy on every one of ${a.maxAttempts} attempts.` }
        : retry("BUSY", "Line was busy — trying again shortly.")

    case "VOICEMAIL":
      if (a.voicemailPolicy === "LEAVE_MESSAGE") {
        return { state: "COMPLETED", nextAttemptAt: null, consumesAttempt: true,
                 note: "Left a voicemail." }
      }
      if (a.voicemailPolicy === "HANG_UP_DONE") {
        return { state: "EXHAUSTED", nextAttemptAt: null, consumesAttempt: true,
                 note: "Reached voicemail." }
      }
      return spent
        ? { state: "EXHAUSTED", nextAttemptAt: null, consumesAttempt: true,
            note: `Reached voicemail on every one of ${a.maxAttempts} attempts.` }
        : retry("VOICEMAIL", "Reached voicemail — will try again later.")

    case "INVALID_NUMBER":
      return { state: "FAILED", nextAttemptAt: null, consumesAttempt: true,
               note: "This number isn't reachable. Check it and add them again." }

    case "REJECTED":
      return { state: "SUPPRESSED", nextAttemptAt: null, consumesAttempt: true,
               note: "The call was rejected — this number won't be tried again." }

    case "CANCELLED":
      // Nothing happened, so nothing is spent. Straight back into the queue.
      return { state: "PENDING", nextAttemptAt: a.now, consumesAttempt: false,
               note: "Call cancelled before it started." }

    case "PROVIDER_ERROR":
      if (a.faultNo + 1 >= MAX_FAULTS) {
        return { state: "FAILED", nextAttemptAt: null, consumesAttempt: false,
                 note: "We couldn't complete a call to this number after several tries." }
      }
      // The attempt is handed back: a fault on our side or the provider's is not
      // the lead's fault, and burning their attempts on an outage would quietly
      // finish a campaign that never actually called anyone.
      return { ...retry("PROVIDER_ERROR", "The call didn't go through — retrying."),
               consumesAttempt: false }
  }
}

/* ── Calling window ────────────────────────────────────────────────────── */

export type Window = {
  timezone: string
  /** "HH:MM", 24 hour. */
  start: string
  end: string
  /** ISO day of week, Monday = 1. */
  days: number[]
}

/**
 * Is `at` inside the window?
 *
 * The claim statement enforces this in SQL so nothing can dial around it. This
 * is the same rule in TypeScript, for deciding whether a scheduled retry should
 * be DEFERRED rather than RETRY_WAIT, and for telling a tenant when their
 * campaign will next do anything.
 */
export function withinWindow(w: Window, at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: w.timezone,
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(at)

  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ""
  const hhmm = `${get("hour")}:${get("minute")}`
  const isoDay = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1

  return w.days.includes(isoDay) && hhmm >= w.start && hhmm < w.end
}

/**
 * When the window next opens, at or after `from`.
 *
 * Walks forward in ten-minute steps for up to nine days. Crude, and
 * deliberately so — the alternative is timezone arithmetic with DST edges, and
 * this runs once per deferred lead rather than in any hot path. Returns null if
 * the window can never open, which means the campaign was configured with no
 * days selected.
 */
export function nextWindowOpen(w: Window, from: Date): Date | null {
  if (!w.days.length || w.start >= w.end) return null

  const STEP = 10 * MINUTE
  const limit = from.getTime() + 9 * 24 * HOUR

  for (let t = from.getTime(); t <= limit; t += STEP) {
    const at = new Date(t)
    if (withinWindow(w, at)) return at
  }
  return null
}
