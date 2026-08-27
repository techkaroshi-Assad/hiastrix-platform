/**
 * What the agent actually did on a call, as opposed to what it said it did.
 *
 * The provider stores every tool call and every tool result on the call record,
 * and until now nobody looked at them. Reading them is how four defects were
 * found in a single afternoon that the transcripts alone had hidden: an agent
 * telling a caller "I have noted your request for a callback" having never
 * called the note tool, an agent writing a note claiming a 4pm booking with no
 * booking call anywhere in the conversation, and calendar searches sent out for
 * a year two years in the past.
 *
 * A transcript is what was said. This is what happened. The gap between them is
 * the interesting part, and the second half of this file is about finding it
 * automatically rather than by reading three-minute transcripts by hand.
 *
 * Pure: parsing and pattern matching only, no imports, no network. Safe on
 * either side of the client boundary.
 */

/* ── Reading the actions ───────────────────────────────────────────────── */

export type ActionOutcome =
  /** The tool ran and answered. */
  | "ok"
  /** We refused it deliberately — an unlisted tag, a date in the past. Not a
   *  fault, and worth showing differently from one. */
  | "refused"
  /** It never answered, or the provider gave up waiting. */
  | "failed"

export type CallAction = {
  id: string
  /** The tenant's own name for the tool, as the model saw it. */
  name: string
  /** Our type for it, when the agent's configuration can be matched up. */
  type: string | null
  args: Record<string, unknown>
  /** Kept for when arguments are not valid JSON, which does happen. */
  argsRaw: string
  result: string | null
  outcome: ActionOutcome
  secondsFromStart: number | null
  /** How long the tool took to answer. The provider allows eight seconds. */
  latencyMs: number | null
}

type RawMessage = {
  role?: string
  name?: string
  result?: string
  time?: number
  secondsFromStart?: number
  toolCallId?: string
  toolCalls?: {
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

/**
 * A result the provider itself produced because we never answered.
 *
 * These read like tool output but they are not — nothing of ours ran. Worth
 * separating, because "the calendar had nothing free" and "we never asked the
 * calendar" look identical to the model and could not be more different to us.
 */
const PROVIDER_FAILURE =
  /server rejected|timeout of \d+ms exceeded|no tool call result|failed to (?:call|reach)/i

/**
 * Our own refusals, which all open by saying what cannot be done.
 *
 * Matched on the opening rather than anywhere in the string, because a
 * legitimate answer can easily contain the words — "No existing contact
 * matches" is a true and useful answer, not a failure, and it must not be
 * coloured like one.
 */
const OUR_REFUSAL = /^(?:I can't|I can not|I cannot|I need|That range is in the past)/i

function outcomeOf(result: string | null): ActionOutcome {
  if (result === null) return "failed"
  if (PROVIDER_FAILURE.test(result)) return "failed"
  if (OUR_REFUSAL.test(result.trim())) return "refused"
  return "ok"
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Every tool call on a call, paired with its result.
 *
 * Paired on `toolCallId` rather than by position: the provider interleaves
 * assistant turns between a call and its result, results can arrive out of
 * order, and one turn may carry several calls. Position-matching would look
 * right on the happy path and silently mispair exactly when something has gone
 * wrong — which is when this is read.
 *
 * `typeByName` maps the tenant's tool names onto ours, and comes from the
 * agent's configuration. Without it the actions still list; only the
 * claim-checking below needs the types.
 */
export function readActions(
  messages: unknown,
  typeByName: Record<string, string> = {}
): CallAction[] {
  if (!Array.isArray(messages)) return []
  const rows = messages as RawMessage[]

  const results = new Map<string, RawMessage>()
  for (const m of rows) {
    if (m?.role === "tool_call_result" && typeof m.toolCallId === "string") {
      results.set(m.toolCallId, m)
    }
  }

  const out: CallAction[] = []

  for (const m of rows) {
    if (m?.role !== "tool_calls" || !Array.isArray(m.toolCalls)) continue

    for (const tc of m.toolCalls) {
      const id   = typeof tc?.id === "string" ? tc.id : ""
      const name = tc?.function?.name ?? "unknown"
      const raw  = tc?.function?.arguments ?? ""
      const res  = id ? results.get(id) : undefined
      const result = typeof res?.result === "string" ? res.result : null

      /*
       * `endCall` is the one tool whose entire job is to end the conversation
       * it was called on — the connection can drop before its result ever
       * gets written back, which for every other tool means "never came
       * back" and a red failure pill. Here it means it worked exactly as
       * intended, so it is scored on that basis rather than on whether a
       * reply arrived in time to be recorded.
       */
      const endedTheCall = name === "endCall"

      out.push({
        id: id || `${name}-${out.length}`,
        name,
        type: typeByName[name] ?? null,
        args: parseArgs(raw),
        argsRaw: raw,
        result,
        outcome: endedTheCall && result === null ? "ok" : outcomeOf(result),
        secondsFromStart:
          typeof m.secondsFromStart === "number" ? m.secondsFromStart : null,
        latencyMs:
          typeof m.time === "number" && typeof res?.time === "number"
            ? Math.max(0, res.time - m.time)
            : null,
      })
    }
  }

  return out.sort((a, b) => (a.secondsFromStart ?? 0) - (b.secondsFromStart ?? 0))
}

/* ── Checking what was said against what was done ──────────────────────── */

export type UnbackedClaim = {
  kind: "booked" | "noted" | "recorded"
  /** The sentence the agent said, for showing next to the finding. */
  said: string
  secondsFromStart: number | null
  /** Plain-language description of what is missing. */
  missing: string
}

/**
 * Things an agent says that are only true if a tool ran.
 *
 * Kept narrow on purpose. A false positive here tells somebody their agent
 * lied when it did not, which would make the whole panel worth ignoring within
 * a week — so each pattern is an assertion in the past tense about a specific
 * action, not a promise, an offer or a question. "Shall I book you in?" and
 * "I'll make a note of that" are both fine and neither matches.
 */
const CLAIMS: {
  kind: UnbackedClaim["kind"]
  test: RegExp
  backedBy: string[]
  missing: string
}[] = [
  {
    kind: "booked",
    test: /\b(?:i(?:'ve| have)?\s+(?:now\s+)?(?:booked|scheduled)\b|you(?:'re| are)\s+(?:all set|booked in|booked|scheduled)\b|(?:appointment|slot)\s+(?:is\s+)?(?:now\s+)?(?:booked|confirmed|scheduled)\b)/i,
    backedBy: ["crm.appointment.book"],
    missing: "no appointment was booked",
  },
  {
    kind: "noted",
    test: /\b(?:i(?:'ve| have)?\s+(?:noted|logged|recorded|made a note|written (?:it|that|this) down)\b|(?:i(?:'ve| have)?\s+)?passed\s+(?:it|that|this)\s+on\b)/i,
    backedBy: ["crm.note.add"],
    missing: "nothing was written to their record",
  },
  {
    kind: "recorded",
    test: /\b(?:i(?:'ve| have)?\s+(?:added|created|set up|updated)\s+(?:you|your)\b|you(?:'re| are)\s+now\s+in\s+(?:the|our)\s+system\b)/i,
    backedBy: ["crm.contact.create", "crm.contact.update"],
    missing: "no contact was created or updated",
  },
]

/**
 * Sentences the agent said that no successful tool call supports.
 *
 * Deliberately checked against the whole call rather than only what came
 * before the sentence. An agent that books and then says so a turn early is a
 * timing quirk nobody needs telling about; an agent that says so and never
 * books is the thing worth surfacing.
 *
 * Returns nothing when no action could be typed at all — without the mapping
 * every claim would look unbacked, and a panel that cries wolf on every call is
 * worse than no panel.
 */
export function findUnbackedClaims(
  messages: unknown,
  actions: CallAction[]
): UnbackedClaim[] {
  if (!Array.isArray(messages)) return []
  if (!actions.some(a => a.type !== null)) return []

  const succeeded = new Set(
    actions.filter(a => a.outcome === "ok" && a.type).map(a => a.type as string)
  )

  const out: UnbackedClaim[] = []
  const seen = new Set<UnbackedClaim["kind"]>()

  for (const m of messages as { role?: string; message?: string; secondsFromStart?: number }[]) {
    if (m?.role !== "bot" && m?.role !== "assistant") continue
    const said = typeof m.message === "string" ? m.message.trim() : ""
    if (!said) continue

    for (const claim of CLAIMS) {
      // Once per kind per call. An agent repeating "you're all set" four times
      // is one problem, not four.
      if (seen.has(claim.kind)) continue
      if (!claim.test.test(said)) continue
      if (claim.backedBy.some(t => succeeded.has(t))) continue

      seen.add(claim.kind)
      out.push({
        kind: claim.kind,
        said,
        secondsFromStart:
          typeof m.secondsFromStart === "number" ? m.secondsFromStart : null,
        missing: claim.missing,
      })
    }
  }

  return out
}

/* ── Small helpers for the page ────────────────────────────────────────── */

/**
 * What each action is, in the words a tenant uses.
 *
 * The tool's own name is whatever the tenant called it — `find_contact`,
 * `check_availability` — which is fine but reads like configuration. The label
 * says what happened to a customer's data, which is the question somebody
 * opening this page is actually asking.
 */
export const ACTION_LABEL: Record<string, string> = {
  "crm.contact.find":              "Looked someone up",
  "crm.contact.create":            "Added a new contact",
  "crm.contact.update":            "Changed a contact's details",
  "crm.contact.field.set":         "Filled in a field",
  "crm.note.add":                  "Wrote a note",
  "crm.tag.add":                   "Applied a tag",
  "crm.tag.remove":                "Removed a tag",
  "crm.opportunity.create":        "Opened a deal",
  "crm.opportunity.stage":         "Moved a deal",
  "crm.appointment.availability":  "Checked the diary",
  "crm.appointment.book":          "Booked an appointment",
}

/**
 * The provider's own built-in tools — never in `typeByName` because they
 * are not something a tenant configures in the tool builder, so they are
 * looked up by the raw function name the model actually called instead of
 * by our own type.
 */
const BUILTIN_LABEL: Record<string, string> = {
  endCall:      "Ended the call",
  transferCall: "Transferred the call",
  sms:          "Sent a text",
  dtmf:         "Entered keypad digits",
  apiRequest:   "Called an external API",
}

export function labelFor(action: CallAction): string {
  if (action.type && ACTION_LABEL[action.type]) return ACTION_LABEL[action.type]
  return BUILTIN_LABEL[action.name] || action.name
}

/**
 * The arguments worth reading at a glance.
 *
 * A contact id is noise — it is thirty characters of nothing to a person. What
 * they want to see is the thing the agent typed in: the tag, the search, the
 * date range.
 */
export function argsSummary(action: CallAction): string {
  const a = action.args
  const parts: string[] = []

  for (const k of ["query", "tag", "firstName", "lastName", "phone", "email", "startDate", "endDate", "startTime", "note", "title", "value", "stage"]) {
    const v = a[k]
    if (typeof v === "string" && v.trim()) parts.push(`${k}: ${v.length > 90 ? `${v.slice(0, 90)}…` : v}`)
    else if (typeof v === "number") parts.push(`${k}: ${v}`)
  }

  return parts.join(" · ")
}

/** The provider's ceiling for a tool call. Anything near it is a warning. */
export const TOOL_TIMEOUT_MS = 8000
export const TOOL_SLOW_MS = 5000

export function actionSummary(actions: CallAction[]) {
  return {
    total:    actions.length,
    ok:       actions.filter(a => a.outcome === "ok").length,
    refused:  actions.filter(a => a.outcome === "refused").length,
    failed:   actions.filter(a => a.outcome === "failed").length,
    slowest:  actions.reduce<number | null>(
      (max, a) => (a.latencyMs !== null && (max === null || a.latencyMs > max) ? a.latencyMs : max),
      null
    ),
  }
}
