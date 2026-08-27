/**
 * Turning the provider's own `endedReason` codes into a sentence a tenant can
 * act on without reading Vapi's documentation.
 *
 * `call.start.error-vapi-number-outbound-daily-limit` is a real code and a
 * real thing that will keep happening to anyone running a campaign at volume
 * off a free number — titleCase alone turns it into "Call.Start.Error Vapi
 * Number Outbound Daily Limit", which is readable but explains nothing. This
 * is the difference between a tenant guessing and a tenant knowing exactly
 * what to do next.
 *
 * Deliberately not exhaustive — Vapi's own reference lists dozens of codes,
 * most of them transient infrastructure faults nobody needs a paragraph
 * about. Covers what a tenant can actually act on; everything else falls
 * back to a title-cased version of the raw code, which is still better than
 * nothing.
 */

const REASONS: Record<string, string> = {
  /* ── Account and billing — the ones worth a tenant's attention ────────── */
  "call.start.error-vapi-number-outbound-daily-limit":
    "This phone number hit its daily limit for outbound calls. Either wait for it to reset, or use a different number — a purchased number doesn't carry this limit.",
  "call.start.error-vapi-number-international":
    "This number can't call international destinations. Use a number that supports international calling for this lead.",
  "call.start.error-subscription-frozen":
    "The calling account's payment failed and is frozen. Update the billing details before more calls can go out.",
  "call.start.error-subscription-insufficient-credits":
    "The calling account is out of credit. Add credits or turn on auto-reload.",
  "call.start.error-subscription-concurrency-limit-reached":
    "Too many calls were already running at once for the current plan. This one waits for a slot to free up, or the plan needs a higher concurrency limit.",
  "call.start.error-fraud-check-failed":
    "This call was blocked by the calling platform's own fraud check. If this keeps happening, it needs a support ticket with the platform, not a config change here.",

  /* ── Configuration — usually a setup problem, not a per-call fluke ─────── */
  "assistant-not-found":
    "The agent this number points to no longer exists on the calling platform. Re-save the agent to recreate it.",
  "assistant-not-valid":
    "The agent's configuration was rejected as invalid right before this call. Open the agent and re-save it — the error usually surfaces there.",

  /* ── Normal outcomes — not failures, just worth a plain-language label ── */
  "customer-did-not-answer": "Nobody picked up.",
  "customer-busy": "The line was busy.",
  "assistant-ended-call": "The agent ended the call.",
  "assistant-ended-call-after-message-spoken": "The agent finished what it had to say and ended the call.",
  "assistant-said-end-call-phrase": "The agent said its sign-off and the call ended.",
  "customer-ended-call": "The other party hung up.",
  "exceeded-max-duration": "The call hit its maximum length and was ended automatically.",
  "silence-timed-out": "Nobody said anything for too long, so the call ended.",
  voicemail: "This reached voicemail.",
  "manually-canceled": "This call was cancelled.",
}

/** Case-insensitive, and tolerant of the odd underscore vs. hyphen — the
 *  provider isn't perfectly consistent about it across every code. */
function normalise(reason: string): string {
  return reason.trim().toLowerCase().replace(/_/g, "-")
}

export function friendlyEndedReason(reason: string, fallback: (s: string) => string): string {
  return REASONS[normalise(reason)] ?? fallback(reason)
}
