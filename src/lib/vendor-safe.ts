/**
 * Nothing we render ever names a vendor.
 *
 * ── WHY THIS MODULE EXISTS ────────────────────────────────────────────
 *
 * Hi-Astrix is white-label. Which telephony provider, which model host,
 * which database sits underneath is ours to know and no tenant's to read.
 * That is not a preference, it is the product: a tenant showing their own
 * client a Hi-Astrix screen must never see somebody else's brand on it.
 *
 * It was broken anyway, and in the most avoidable way: a campaign page
 * printed the provider's own error sentence verbatim —
 *
 *     "Couldn't Start Call. Numbers Bought On Vapi Have A Daily Outbound
 *      Call Limit. Import Your Own Twilio Numbers To Scale Without Limits."
 *
 * — because the raw message was carried all the way from the dialer into a
 * React component. Three other paths were doing the same thing more
 * quietly: a paused-campaign reason, an unmapped call-ended code rendered
 * through `titleCase` ("Call.Start.Error Vapi Number Outbound Daily
 * Limit"), and a spreadsheet column of raw codes.
 *
 * So provider text now has exactly one way to reach a screen: through
 * here. Two rules, and they are different jobs:
 *
 *   `refusalSentence()` — classifies a provider refusal into one of our
 *     own sentences. It never echoes the input. This is what UI should
 *     use, because a sentence we wrote cannot leak a brand we did not.
 *
 *   `scrubVendors()`   — a net, not a plan. For text that has to stay
 *     roughly verbatim (an internal report), it replaces vendor names
 *     with neutral equivalents. Use it *in addition to* the above, never
 *     instead of it: a scrubber only removes the names it already knows.
 */

/** Vendor names that must never render. Ordered longest-first so that
 *  multi-word names are replaced before their individual words. */
const VENDOR_REPLACEMENTS: [RegExp, string][] = [
  [/\bnumbers?\s+bought\s+on\s+vapi\b/gi, "numbers from the shared pool"],
  [/\byour\s+own\s+twilio\s+numbers?\b/gi, "your own purchased numbers"],
  [/\bvapi\b/gi, "the calling provider"],
  [/\btwilio\b/gi, "the carrier"],
  [/\btelnyx\b/gi, "the carrier"],
  [/\bvonage\b/gi, "the carrier"],
  [/\bplivo\b/gi, "the carrier"],
  [/\bdidww\b/gi, "the carrier"],
  [/\bsupabase\b/gi, "the database"],
  [/\bstripe\b/gi, "the payment processor"],
  [/\bopenai\b/gi, "the language model"],
  [/\banthropic\b/gi, "the language model"],
  [/\bdeepgram\b/gi, "the transcription engine"],
  [/\belevenlabs\b/gi, "the voice engine"],
  [/\bcartesia\b/gi, "the voice engine"],
  [/\bplayht\b/gi, "the voice engine"],
  [/\bassemblyai\b/gi, "the transcription engine"],
  [/\bresend\b/gi, "the email service"],
  [/\bgohighlevel\b|\bhighlevel\b/gi, "the CRM"],
  [/\bvercel\b/gi, "the host"],
]

/** True when a string names a vendor. For guards and tests. */
export function containsVendor(text: string): boolean {
  return VENDOR_REPLACEMENTS.some(([pattern]) => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })
}

/**
 * Replace vendor names with neutral equivalents.
 *
 * A last line of defence for text that must stay close to verbatim.
 * Prefer `refusalSentence()` wherever the text is only being used to
 * explain something — a sentence of our own is safe by construction.
 */
export function scrubVendors(text: string): string {
  let out = text
  for (const [pattern, replacement] of VENDOR_REPLACEMENTS) {
    pattern.lastIndex = 0
    out = out.replace(pattern, replacement)
  }
  // Also strip provider error codes, which embed vendor names in slugs
  // ("call.start.error-vapi-number-outbound-daily-limit").
  out = out.replace(/\b[a-z]+(?:\.[a-z-]+){2,}\b/gi, "a provider error")
  return out.replace(/\s+/g, " ").trim()
}

/* ── Refusals ──────────────────────────────────────────────────────────── */

export type RefusalCategory =
  /** The number's own daily allowance upstream, not ours. */
  | "number-daily-limit"
  /** No credit / frozen account on the calling platform. */
  | "account-credit"
  /** Too many calls at once. */
  | "concurrency"
  /** Misconfiguration: unknown assistant or number. */
  | "configuration"
  /** Anything we have not classified. */
  | "other"

export function refusalCategory(raw: string): RefusalCategory {
  const m = raw.toLowerCase()
  if (/daily outbound call limit|outbound-daily-limit|daily limit/.test(m)) return "number-daily-limit"
  if (/wallet|insufficient (?:credit|balance|funds)|purchase more credits|subscription|billing/.test(m)) return "account-credit"
  if (/concurrency|too many concurrent/.test(m)) return "concurrency"
  if (/not[- ]found|not[- ]valid|invalid api key|unauthorized/.test(m)) return "configuration"
  return "other"
}

/**
 * Our sentence for a provider refusal — for tenant-facing surfaces.
 *
 * Deliberately built from the category alone. The raw message is read to
 * classify and then discarded, so there is no path by which its wording
 * can reach a screen.
 */
export function refusalSentence(raw: string): string {
  switch (refusalCategory(raw)) {
    case "number-daily-limit":
      return "The number reached its daily calling allowance, so these calls were not placed."
    case "account-credit":
      return "Calling was temporarily unavailable on this account, so these calls were not placed."
    case "concurrency":
      return "Too many calls were in progress at once, so these calls were not placed."
    case "configuration":
      return "A setup problem stopped these calls being placed."
    default:
      return "These calls could not be placed."
  }
}

/**
 * The same thing, as a reason a paused campaign shows, with what to do.
 */
export function refusalPausedReason(raw: string): string {
  const what = refusalSentence(raw)
  switch (refusalCategory(raw)) {
    case "number-daily-limit":
      return `${what} Calling resumes automatically once the allowance refreshes, or sooner if another number is attached to this agent. Nobody on the list has been marked as failed.`
    case "account-credit":
      return `${what} This affects every call rather than one number. Contact support and the campaign will pick up where it stopped — nobody on the list has been marked as failed.`
    case "concurrency":
      return `${what} Lower the campaign's simultaneous calls, or wait for the current ones to finish, then press Resume.`
    case "configuration":
      return `${what} Check the agent and its phone number, then press Resume. Nobody on the list has been marked as failed.`
    default:
      return `${what} Press Resume once it's sorted — nobody on the list has been marked as failed.`
  }
}
