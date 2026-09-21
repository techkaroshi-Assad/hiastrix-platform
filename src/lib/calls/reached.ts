/**
 * What actually picked up.
 *
 * ── WHY THIS IS NOT "DURATION ≥ 10 SECONDS" ──────────────────────────
 *
 * The dialer's CONNECTED rule (lib/dialer/outcome.ts) is "ten seconds of
 * audio means the lead was reached", and for *retry scheduling* that is the
 * right rule: a phone menu that plays for a minute is a number that answers,
 * and calling it again in twenty minutes will not help. For *reporting* it
 * is the wrong rule, and badly so: on the first production campaign, 43% of
 * "connected" calls were an automated menu and nobody ever spoke. The
 * analytics page said 92% connected. It was closer to 40%.
 *
 * So every call gets a second classification, stored on the row at
 * end-of-call so analytics is a GROUP BY rather than a transcript scan:
 *
 *   HUMAN      a person spoke — receptionist, decision-maker, anyone
 *   IVR        only an automated menu was heard
 *   VOICEMAIL  answering machine
 *   NO_ANSWER  nobody picked up, busy, or the call never rang
 *   FAILED     the provider or carrier could not place it
 *
 * ── PRECEDENCE ────────────────────────────────────────────────────────
 *
 * 1. The agent's own extraction (`whoAnswered` from the outbound preset),
 *    when present — the model read the whole call and was asked exactly
 *    this question.
 * 2. The provider's ended reason, for the unambiguous ones.
 * 3. A transcript heuristic for the menu case, because ended reason says
 *    "assistant-ended-call" whether the assistant hung up on a person or
 *    on a loop of "press 1".
 * 4. Duration, as the last resort — the dialer's own rule.
 *
 * Pure. No database, no clock.
 */

export type Reached = "HUMAN" | "IVR" | "VOICEMAIL" | "NO_ANSWER" | "FAILED"

export const REACHED_LABEL: Record<Reached, string> = {
  HUMAN:     "Spoke to a person",
  IVR:       "Phone menu only",
  VOICEMAIL: "Voicemail",
  NO_ANSWER: "No answer",
  FAILED:    "Couldn't connect",
}

/**
 * Lines a phone menu says and a person does not. Matched against the other
 * party's turns only; the assistant narrating "pressing 2" is not a menu.
 */
const IVR_LINE =
  /\bpress\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|zero|pound|star|the pound)\b|\bstay on the line\b|\bmenu options?\b|\bto repeat (?:this|these)\b|\blisten carefully\b|\bdial\s+9\s*1\s*1\b|\bhours of operation\b|\bpara español\b|\bfor english\b|\byour call (?:is important|may be (?:monitored|recorded)|will be answered|is being transferred)\b|\bplease hold\b|\ball (?:of )?our (?:representatives|agents) are\b|\bcan't find that option\b|\bnot a valid\b|\binvalid (?:response|entry|option|selection)\b|\bdid not (?:enter|receive|understand)\b|\bthis call (?:will be|is being|may be) recorded\b|\bfor quality\b|\btraining purposes\b|\bplease (?:enter|say|listen|visit our website)\b|\bsay or enter\b|\busing your (?:dial ?pad|keypad|telephone)\b|\bif you know your party's extension\b|\bour office is (?:currently |now )?closed\b|\bwelcome to\b|\bplease hang up\b/i

const VOICEMAIL_LINE =
  /\bleave (?:a|your) (?:message|name and number)\b|\bafter the (?:tone|beep)\b|\bnot available to take your call\b|\bvoice ?mail\b|\bmailbox\b|\byou(?:'ve| have) reached the voice\b/i

/**
 * A line a person says and a menu does not.
 *
 * The first version of this file counted menu lines and called anything
 * else a person. It was wrong 224 times out of 433 on the first backfill:
 * a menu's audio arrives at the transcriber as many short fragments — "For
 * billing", "2.", "Please try again", "Your call cannot be transferred" —
 * and none of them say "press". So the rule is now the other way round: a
 * person is present only if some line reads like one. Short conversational
 * tokens, first-person plural about the business, the greeting a
 * receptionist gives, the ways a call gets declined.
 */
const HUMAN_LINE =
  /\b(?:yes|yeah|yep|nope|speaking|this is \w+|how can i help|how may i help|what(?:'s| is) this (?:about|regarding|in regards to)|who(?:'s| is) (?:this|calling)|who am i speaking|okay|ok|sure|sorry|not interested|hold on|one (?:moment|second|sec)|can i|may i|i'm|i am|i'll|i can|i don't|we don't|we use|we already|we handle|she's|he's|thanks|thank you,? bye|no thank you|no thanks|call back|send (?:me|us) (?:an? )?(?:email|information|info)|email it|go ahead|um|uh|what do you|which company|where are you calling|let me (?:check|see|get|connect|transfer))\b/i

/**
 * Openers a recording says as readily as a person — "Thank you for calling
 * X", "Hello, you've reached X" — carry no signal, and a bare "Hello" only
 * counts when something conversational follows it on the same line.
 */
const GREETING_LINE =
  /^(?:hi|hello|hey|good (?:morning|afternoon|evening))?[.,!]?\s*(?:and\s+)?(?:thank you|thanks) for calling\b|^(?:hi|hello|hey)?[.,!]?\s*you(?:'ve| have) reached\b/i

/** A person's turn on a phone is short. Recorded marketing is not. */
const MAX_HUMAN_LINE = 160

/** "Hello?" on its own is a person picking up. A menu never says only that. */
const BARE_HELLO = /^(?:hello|hi|hey|yes|yeah)\??[.!]?$/i

function isHumanLine(t: string): boolean {
  if (IVR_LINE.test(t) || VOICEMAIL_LINE.test(t)) return false
  if (GREETING_LINE.test(t)) return false
  if (t.length > MAX_HUMAN_LINE) return false
  return BARE_HELLO.test(t.trim()) || HUMAN_LINE.test(t)
}

/** The other party's turns, from the "Role: text" transcript format. */
function otherPartyTurns(transcript: string): string[] {
  const out: string[] = []
  for (const raw of transcript.split(/\r?\n/)) {
    const line = raw.trim()
    const m = /^(user|customer|caller)\s*:\s*(.*)$/i.exec(line)
    if (m && m[2]) out.push(m[2].trim())
  }
  return out
}

/**
 * The `whoAnswered` value from the outbound extraction preset, normalised.
 * Tolerant of case, spacing and the model paraphrasing ("Gatekeeper /
 * receptionist").
 */
export function reachedFromWhoAnswered(value: unknown): Reached | null {
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (/decision|gatekeeper|reception|front.?desk|staff|owner|manager|person|human|spoke/.test(v)) return "HUMAN"
  if (/\bivr\b|menu|automated|auto.?attendant/.test(v)) return "IVR"
  if (/voice.?mail|answering|machine/.test(v)) return "VOICEMAIL"
  if (/nobody|no.?one|no answer|nothing/.test(v)) return "NO_ANSWER"
  return null
}

export function classifyReached(a: {
  endedReason: string | null
  durationSeconds: number
  transcript: string | null
  /** `analysis.structuredData` as stored — may be anything. */
  structuredData?: unknown
}): { reached: Reached; ivrSeen: boolean } {
  const reason = (a.endedReason ?? "").toLowerCase()
  const turns = otherPartyTurns(a.transcript ?? "")
  const ivrTurns = turns.filter(t => IVR_LINE.test(t)).length
  const voicemailTurns = turns.filter(t => VOICEMAIL_LINE.test(t)).length
  const humanTurns = turns.filter(isHumanLine).length
  const ivrSeen = ivrTurns > 0

  // 1. The model's own answer, when the outbound preset is in use.
  const sd = a.structuredData
  if (sd && typeof sd === "object" && !Array.isArray(sd)) {
    const fromModel = reachedFromWhoAnswered((sd as Record<string, unknown>).whoAnswered)
    if (fromModel) return { reached: fromModel, ivrSeen: ivrSeen || fromModel === "IVR" }
  }

  // 2. Unambiguous ended reasons.
  if (/voicemail|answering-machine|machine-detected/.test(reason)) return { reached: "VOICEMAIL", ivrSeen }
  if (/did-not-answer|no-answer|noanswer|customer-busy|\bbusy\b/.test(reason)) return { reached: "NO_ANSWER", ivrSeen }
  if (/error|failed|fault|invalid|rejected|blocked|forbidden|unallocated|not-in-service/.test(reason)) {
    return { reached: "FAILED", ivrSeen }
  }

  // 3. Somebody spoke like a person. Wins over any menu lines on the same
  //    call — that is the "menu, then a receptionist" case, which is a
  //    person reached.
  if (humanTurns >= 1) return { reached: "HUMAN", ivrSeen }

  // 4. Nobody did, and we heard a machine of one kind or another.
  if (voicemailTurns >= 1) return { reached: "VOICEMAIL", ivrSeen }
  if (ivrTurns >= 1) return { reached: "IVR", ivrSeen: true }

  // 5. No recognisable line either way. Fall back to the dialer's rule for
  //    a call with audio; nothing at all is nobody.
  if (turns.length === 0) return { reached: "NO_ANSWER", ivrSeen }
  return { reached: a.durationSeconds >= 10 ? "HUMAN" : "NO_ANSWER", ivrSeen }
}
