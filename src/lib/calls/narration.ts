/**
 * Catching the agent talking about the call instead of having it.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────
 *
 * On a phone call there is one output channel and it goes to a loudspeaker.
 * The model has nowhere to think, so when an instruction asks it to make a
 * judgement it sometimes writes the judgement down — and the judgement is
 * spoken. Real turns from production, heard by real people:
 *
 *   "I'll press 1. 1."
 *   "Pressing 1 for billing. It seems the line is closed. I'll end the call now."
 *   "Since the menu seems to be looping, I'm going to hang up and call again."
 *   "Since the system isn't recognizing the selection for billing, I'll try
 *    pressing 6 for all..."
 *   "Since there's no existing contact on record, could you please provide me
 *    with the email address of the person who handles billing?"
 *
 * The provider has no output filter — its own IVR guide offers nothing but
 * "avoid saying anything if using the dtmf tool", which is a prompt. So a
 * prompt is the only *prevention* available, and a prompt is probabilistic.
 *
 * This module is the other half: **measurement that cannot be skipped**. It
 * runs on every call, for every tenant, whatever they configured, and writes
 * what it found onto the call record. Prevention may fail quietly; detection
 * does not. lib/dialer/narration-guard.ts turns the measurement into a stop.
 *
 * ── ON PRECISION ──────────────────────────────────────────────────────
 *
 * The first version of this counted 48 calls. It was wrong in both
 * directions: it missed the dominant failure (saying a keypad digit aloud,
 * 97 calls) and it flagged ordinary courtesy as a defect —
 *
 *   "Thanks, Maya. I'll wait for the transfer."          ← perfectly fine
 *   "It seems like your sentence cut off. Repeat that?"  ← perfectly fine
 *
 * Both of those are an agent behaving well. A detector that cries wolf gets
 * switched off, and a threshold built on it pauses campaigns for no reason,
 * so every pattern below is anchored to the *subject* of the sentence: the
 * agent narrating **the mechanism** (a keypad, the menu, our records, its own
 * hang-up) is the defect. The agent talking about **the person** — waiting for
 * them, holding for them, asking them to repeat — is just conversation.
 *
 * Client-safe: pure string matching, no imports.
 */

export type NarrationKind =
  | "keypad"      // says a digit it is pressing, or "pressing 2"
  | "stage"       // speaks a stage direction: "Staying silent.", "Call ends."
  | "hang-up"     // announces that it is ending the call
  | "mechanism"   // comments on the menu, the system, the line's behaviour
  | "records"     // reveals what our CRM does or doesn't hold
  | "tooling"     // names a function: endCall, dtmf, "the end call function"

export const NARRATION_LABEL: Record<NarrationKind, string> = {
  keypad:    "Said a keypad press out loud",
  stage:     "Read a stage direction aloud",
  "hang-up": "Announced that it was hanging up",
  mechanism: "Commented on the phone menu or the line",
  records:   "Mentioned what our records hold",
  tooling:   "Named one of its own functions",
}

/**
 * What a person on the other end would think, per category. Used on the call
 * detail page — an operator seeing a flag needs to know whether it embarrassed
 * them in front of a prospect or merely talked to a menu.
 */
export const NARRATION_WHY: Record<NarrationKind, string> = {
  keypad:    "Keypad presses are silent. Saying the digit aloud does nothing and sounds like a machine reading its own script.",
  stage:     "The agent said what it was doing instead of doing it — announcing \"staying silent\" out loud is the opposite of staying silent.",
  "hang-up": "Ending a call needs no announcement. Saying it first is the clearest possible signal that nobody is really there.",
  mechanism: "Describing the menu or the line tells the other party they are talking to software working through a problem.",
  records:   "What is or isn't on file is internal. Saying it aloud tells a stranger how the list they are on was built.",
  tooling:   "A function name has no meaning to the person hearing it and gives away how the agent is built.",
}

/*
 * Each rule is anchored to the mechanism being the subject.
 *
 * `keypad` deliberately does NOT require a leading "I'll" — the commonest
 * real form is a bare "Pressing 5 again for billing", and half of these
 * appeared with the digit repeated afterwards ("I'll press 1. 1.") because
 * the model read its own tool argument out.
 *
 * `mechanism` requires one of menu/system/line/call as the thing being
 * described. Without that anchor it matched "It seems like your sentence cut
 * off", which is an agent listening properly.
 *
 * `hang-up` requires an intent verb before it, so a caller's own "I have to
 * go" echoed back does not count, and so "I'll wait while you transfer me"
 * — courtesy, not narration — stays clear.
 */
const RULES: { kind: NarrationKind; re: RegExp }[] = [
  {
    kind: "keypad",
    re: /\b(press|pressing|pressed|dial|dialing|entering|entered)\b[^.?!]{0,24}?\b(?:the\s+)?(?:number\s+|digit\s+|option\s+|key\s+)?[0-9#*]\b/i,
  },
  {
    // "Digit pressed, 4." — the model reading its own tool argument back.
    kind: "keypad",
    re: /\bdigit\s+pressed\b|\bpressing\s+nothing\b|\bsilently\s+pressing\b/i,
  },
  /*
   * Stage directions.
   *
   * The most absurd of these and the one that proves the diagnosis: told to
   * "reply with a single space so nothing is spoken", the model instead says
   * the words "Remain silent and wait for the menu options." out loud. It
   * treated the instruction as a line to perform rather than an action to
   * take. Same for "Call ends." and "End call." — screenplay directions,
   * read to a stranger.
   *
   * The distinguishing feature is a missing subject: a bare gerund or
   * imperative describing the agent's own conduct. "Sure, I'll hold" and
   * "Hold on a sec" have a speaker and an addressee and are ordinary
   * courtesy — they must not be flagged, and the anchor words below are what
   * keeps them clear.
   */
  {
    kind: "stage",
    re: /^\s*(?:staying|stay|remaining|remain|listening|keeping|continuing|holding|waiting|silence|silently)\b[^.?!]{0,60}?\b(?:silent|silence|quietly|menu|line|prompt|representative|agent|operator|live\s+person|connects?)\b/i,
  },
  {
    kind: "stage",
    re: /\b(?:call\s+ends|end\s+call)\s*[.!]|\b(?:waiting|staying|listening|holding)\s+silently\b|\blet'?s\s+(?:wait|hold|listen|see)\b[^.?!]{0,30}\b(?:menu|prompt|picks?\s+up|leads?)\b/i,
  },
  {
    kind: "hang-up",
    re: /\b(?:i'?ll|i\s+will|i'?m\s+going\s+to|i\s+am\s+going\s+to|let\s+me|going\s+to)\b[^.?!]{0,32}?\b(?:hang\s+up|end\s+(?:the|this)\s+call|disconnect|terminate\s+the\s+call)\b/i,
  },
  {
    kind: "mechanism",
    re: /\b(?:the\s+)?(?:menu|ivr|system|line|recording|call)\b[^.?!]{0,44}?\b(?:loop(?:ed|ing|s)?|repeat(?:ed|ing|s)?|did\s*n[o']t\s+register|is\s*n[o']t\s+regist|not\s+recogni[sz]|is\s*n[o']t\s+recogni[sz]|is\s+closed|transferred\s+me|cut\s+me\s+off|did\s*n[o']t\s+(?:provide|offer)|has\s+no\s+(?:option|relevant))\b/i,
  },
  {
    // The inverse order of the above: "It seems the menu…", "Since the system…"
    kind: "mechanism",
    re: /\b(?:seems|appears|looks\s+like|since|because)\b[^.?!]{0,20}?\b(?:the\s+)?(?:menu|ivr|system|phone\s+tree|line)\b/i,
  },
  {
    kind: "mechanism",
    re: /\b(?:would\s*n[o']t|is\s*n[o']t|not)\s+be\s+productive\b|\bno\s+relevant\s+option\b|\bcentral\s+(?:line|number|system)\b|\bunrelated\s+menu\b/i,
  },
  /*
   * Deliberately narrow.
   *
   * An inbound receptionist saying "I don't see your number on record, may I
   * take your name?" is doing its job, and an earlier draft flagged it. What
   * is never acceptable is the internal vocabulary — the lookup, the CRM, "no
   * existing contact" — or prefacing a question to a stranger with our
   * reasoning about our own database.
   */
  {
    kind: "records",
    re: /\bno\s+existing\s+contact\b|\bour\s+(?:crm|database|records\s+system)\b|\bthe\s+lookup\b|\b(?:since|because)\b[^.?!]{0,30}\b(?:on\s+record|in\s+(?:our|the)\s+(?:records?|system|database))\b/i,
  },
  {
    kind: "tooling",
    re: /\bend\s*-?\s*call\s+(?:function|tool)\b|\bendcall\b|\bdtmf\b|\b(?:using|use|call(?:ing)?)\s+the\s+(?:end\s*call|transfer|dtmf)\s+(?:function|tool)\b|\bfunction\s+call\b/i,
  },
]

/**
 * Turns that are the agent's own speech.
 *
 * Tool-call entries and system messages are excluded: a `dtmf` tool call
 * legitimately contains the digit, and flagging it would report the fix as
 * the bug.
 */
type Turn = { role?: string; message?: string }

function agentTurns(messages: unknown): string[] {
  if (!Array.isArray(messages)) return []
  return (messages as Turn[])
    .filter(m =>
      (m?.role === "bot" || m?.role === "assistant") &&
      typeof m?.message === "string" &&
      m.message.trim() !== ""
    )
    .map(m => (m.message as string).trim())
}

export type NarrationFinding = {
  kind: NarrationKind
  /** The sentence as spoken, trimmed for display. Evidence, not a guess. */
  quote: string
}

export type NarrationResult = {
  kinds: NarrationKind[]
  /** How many separate turns were flagged — a call can narrate repeatedly. */
  turns: number
  findings: NarrationFinding[]
}

/** Clip to the offending sentence so the call page shows evidence, not an essay. */
function sentenceAround(text: string, re: RegExp): string {
  const parts = text.split(/(?<=[.?!])\s+/)
  const hit = parts.find(p => re.test(p)) ?? text
  return hit.length > 180 ? `${hit.slice(0, 177)}…` : hit
}

/**
 * The one detector. Everything that reports narration calls this and nothing
 * re-implements it — the first audit and the first fix disagreed by a factor
 * of two precisely because the regex lived in a SQL console and not in a file.
 */
export function detectNarration(messages: unknown): NarrationResult {
  const findings: NarrationFinding[] = []
  const kinds = new Set<NarrationKind>()
  let turns = 0

  for (const text of agentTurns(messages)) {
    let flagged = false
    for (const { kind, re } of RULES) {
      if (!re.test(text)) continue
      kinds.add(kind)
      flagged = true
      // One quote per kind per call is enough to show an operator what happened.
      if (!findings.some(f => f.kind === kind)) {
        findings.push({ kind, quote: sentenceAround(text, re) })
      }
    }
    if (flagged) turns++
  }

  return { kinds: [...kinds], turns, findings }
}

/** Did this call contain any of it? The cheap check for counters and guards. */
export const narrated = (messages: unknown): boolean =>
  detectNarration(messages).kinds.length > 0
