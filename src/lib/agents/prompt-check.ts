/**
 * Reading an agent's setup and saying what will go wrong.
 *
 * Client-safe: pure string work, no dependencies beyond the tool types.
 *
 * ── THE FAILURE THIS EXISTS FOR ───────────────────────────────────────
 *
 * Switching a tool on grants a capability. It does not produce a behaviour.
 * An agent with "book an appointment" enabled and nothing in its prompt about
 * booking will hold a perfectly pleasant conversation and never book anything —
 * and from the outside that looks like the tool is broken, not like the prompt
 * is silent. It is the single most common way an agent underperforms, and it is
 * completely invisible until somebody listens to a recording.
 *
 * So every check here answers the same question: *what did you set up that
 * won't actually happen?* Not style, not length, not spelling.
 *
 * ── WHY MATCHING ON WORDS IS ENOUGH ───────────────────────────────────
 *
 * These look for the subject, not the phrasing — "book", "appointment", "slot"
 * rather than a sentence template. That is deliberately loose, because the point
 * is to catch a prompt that never raises the topic at all, and a prompt that
 * mentions booking in any words at all will mention one of those.
 *
 * The cost of being loose is a missed warning. The cost of being strict is
 * warning people whose prompt is fine, which teaches them to ignore it — and a
 * checker nobody reads is worse than no checker.
 */

import type { AgentTool, AgentToolType } from "@/lib/vapi/tools"
import { checkStructure } from "@/lib/agents/prompt-structure"

/**
 * Three levels, and the top one is new.
 *
 * `problem` and `suggestion` were both advisory, and an agent whose prompt
 * carried the same paragraph four times went live anyway — because a warning is
 * a thing you scroll past. A `blocker` is not advice: the platform refuses to
 * put the agent on the air until it is gone.
 *
 * The bar is deliberately high. A blocker must be something nobody could
 * reasonably have intended — a duplicated section, a placeholder that will be
 * read aloud. Anything arguable stays a warning, because a platform that
 * refuses to publish over a matter of taste is one people learn to route
 * around.
 */
export type Severity = "blocker" | "problem" | "suggestion"

export type Finding = {
  id: string
  severity: Severity
  /** What is wrong, in one sentence. */
  title: string
  /** Why it matters — the consequence, not a restatement. */
  detail: string
  /** A line to add to the prompt, when there is an obvious one. */
  insert?: string
  /** Which tab of the editor fixes it. */
  where: "identity" | "tools" | "conversation" | "after"
  /**
   * The DOM id of the control that fixes it.
   *
   * `where` alone was not enough, and the gap was visible rather than
   * theoretical: "Take me there" switched the tab and nothing else, so on a
   * finding about the system prompt — already on the tab you were looking at,
   * three screens below the fold behind the template picker — pressing it did
   * nothing at all. It read as a dead button.
   *
   * The tab says which screen; this says where on it.
   */
  field?: FieldTarget
}

/**
 * Every control a finding can point at.
 *
 * A union rather than a string, so a typo is a compile error instead of a
 * silently dead button — which is the exact failure this whole field exists to
 * fix, and it would be embarrassing to reintroduce it one level down.
 */
export type FieldTarget =
  | "system-prompt"
  | "first-message"
  | "tools"
  | "max-tokens"
  | "voicemail-detect"
  | "voicemail-message"
  | "structured-schema"

export type CheckInput = {
  systemPrompt: string
  firstMessage: string
  tools: AgentTool[]
  config: {
    voicemailDetectionEnabled?: boolean
    voicemailMessage?: string
    structuredDataEnabled?: boolean
    structuredDataSchema?: string
    successEvaluationEnabled?: boolean
    maxTokens?: number
    endCallPhrases?: string[]
  }
  /** True when this agent is attached to at least one outbound campaign. */
  usedForOutbound?: boolean
}

/* ── Vocabulary ────────────────────────────────────────────────────────── */

type ToolExpectation = {
  /** Any one of these appearing in the prompt counts as "mentioned". */
  words: string[]
  title: string
  detail: string
  insert: string
}

const EXPECTATIONS: Partial<Record<AgentToolType, ToolExpectation>> = {
  "crm.contact.find": {
    words: ["look", "lookup", "look up", "find", "search", "check if", "already", "on record", "existing"],
    title: "Nothing tells it to look the caller up",
    detail:
      "It can search your CRM but has no reason to, so it will treat everyone as a stranger — and any tool that acts on a contact will have nobody to act on.",
    insert:
      "Early in the call, get their phone number or email and look them up, so you know whether they are already a customer.",
  },
  "crm.contact.create": {
    words: ["create", "add them", "new contact", "new lead", "not on record", "take their name", "sign them up"],
    title: "Nothing tells it when to add somebody new",
    detail:
      "It will either never create a record, or create one for people who already have one.",
    insert:
      "If the lookup finds nobody, take their name and create a contact for them.",
  },
  "crm.contact.update": {
    words: ["update", "correct", "change their", "amend", "fix their"],
    title: "Nothing tells it to correct details",
    detail: "It won't update a record even when the caller gives it a better number or a new email.",
    insert:
      "If they give you a detail that differs from what is on record, confirm it and update their contact.",
  },
  "crm.contact.field.set": {
    words: ["record", "save", "store", "note down", "field", "answer"],
    title: "Nothing tells it what to save",
    detail:
      "It can write to your custom fields but doesn't know which answers belong in them, so they'll stay empty.",
    insert: "Save each answer they give you against their record as you go.",
  },
  "crm.note.add": {
    words: ["note", "write up", "summar", "log", "record what", "write down"],
    title: "Nothing tells it to write a note",
    detail:
      "The call will happen and leave nothing behind on the contact, so whoever picks it up next starts from nothing.",
    insert:
      "Before the call ends, write a note on their record covering what they wanted and what was agreed.",
  },
  "crm.tag.add": {
    words: ["tag", "label", "mark them", "flag"],
    title: "Nothing tells it when to tag",
    detail:
      "Tags are what start your workflows. If the agent never applies one, nothing downstream happens.",
    insert: "Tag the contact with the outcome before you end the call.",
  },
  "crm.tag.remove": {
    words: ["remove the tag", "untag", "clear the tag", "no longer"],
    title: "Nothing tells it when to remove a tag",
    detail: "It will only ever add tags, so a stale one stays on the record forever.",
    insert: "If a tag no longer applies to them, remove it.",
  },
  "crm.opportunity.create": {
    words: ["deal", "opportunity", "pipeline", "open a"],
    title: "Nothing tells it to open a deal",
    detail: "Interested callers won't appear in your pipeline at all.",
    insert: "If they are interested, open a deal for them in the pipeline.",
  },
  "crm.opportunity.stage": {
    words: ["stage", "move the deal", "pipeline", "advance"],
    title: "Nothing tells it to move the deal along",
    detail: "Deals will sit in whatever stage they were already in, whatever the call decided.",
    insert: "Move their deal to the stage that matches what they told you.",
  },
  "crm.appointment.availability": {
    words: ["availab", "free", "slot", "diary", "calendar", "times", "when suits"],
    title: "Nothing tells it to check the calendar",
    detail:
      "It will offer times it invented rather than times you actually have — which is how double bookings happen.",
    insert:
      "Check the calendar for what is genuinely free before you offer any times, and only ever offer slots it returned.",
  },
  "crm.appointment.book": {
    words: ["book", "appointment", "schedule", "slot", "confirm the time"],
    title: "Nothing tells it to book",
    detail:
      "It can take a booking but has no instruction to, so it will discuss times and then end the call without one.",
    insert:
      "Book the time they choose, then read the day, date and time back to them to confirm.",
  },
}

/** Tools whose usefulness depends on another being described first. */
const ORDERING: { first: AgentToolType; then: AgentToolType; note: string }[] = [
  {
    first: "crm.appointment.availability",
    then: "crm.appointment.book",
    note: "Your prompt mentions booking before it mentions checking what's free. Agents follow the order you write, so it may offer a time it hasn't checked.",
  },
  {
    first: "crm.contact.find",
    then: "crm.contact.create",
    note: "Your prompt mentions creating a contact before looking one up. Written in that order, it will make duplicates of people you already have.",
  },
]

const has = (text: string, words: string[]) => {
  const t = text.toLowerCase()
  return words.some(w => t.includes(w))
}

/** Where a topic is first raised, or -1. */
const firstMention = (text: string, words: string[]) => {
  const t = text.toLowerCase()
  let at = -1
  for (const w of words) {
    const i = t.indexOf(w)
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  return at
}

/** Where a topic is last raised, or -1. */
const lastMention = (text: string, words: string[]) => {
  const t = text.toLowerCase()
  let at = -1
  for (const w of words) {
    const i = t.lastIndexOf(w)
    if (i > at) at = i
  }
  return at
}

/* ── The check ─────────────────────────────────────────────────────────── */

export function checkAgent(input: CheckInput): Finding[] {
  const findings: Finding[] = []
  const prompt = input.systemPrompt ?? ""
  const first = input.firstMessage ?? ""
  const both = `${prompt}\n${first}`
  const enabled = new Set(input.tools.map(t => t.type))

  /* ── The main event: tools nothing asks for ──────────────────────── */

  for (const [type, expect] of Object.entries(EXPECTATIONS) as [AgentToolType, ToolExpectation][]) {
    if (!enabled.has(type)) continue
    if (has(both, expect.words)) continue
    findings.push({
      id: `unused:${type}`,
      severity: "problem",
      title: expect.title,
      detail: expect.detail,
      insert: expect.insert,
      where: "identity",
      field: "system-prompt",
    })
  }

  /* ── Ordering ────────────────────────────────────────────────────── */

  /*
   * First mention of the prerequisite against the LAST mention of the thing
   * that depends on it — not first against first.
   *
   * Almost every prompt opens by stating the role: "You book appointments for
   * Acme." Compared first-to-first, that lone sentence puts booking ahead of
   * everything and every well-written booking prompt gets flagged. What
   * actually matters is whether the prerequisite is described somewhere before
   * the instruction that needs it, which is exactly this comparison — and it
   * still catches the genuinely backwards prompt, where the prerequisite only
   * appears after the last mention of the thing it should precede.
   */
  for (const rule of ORDERING) {
    if (!enabled.has(rule.first) || !enabled.has(rule.then)) continue
    const a = firstMention(prompt, EXPECTATIONS[rule.first]!.words)
    const b = lastMention(prompt, EXPECTATIONS[rule.then]!.words)
    if (a === -1 || b === -1) continue          // already reported as missing
    if (a < b) continue
    findings.push({
      id: `order:${rule.first}:${rule.then}`,
      severity: "suggestion",
      title: "These are described in the wrong order",
      detail: rule.note,
      where: "identity",
      field: "system-prompt",
    })
  }

  /* ── The prompt itself ───────────────────────────────────────────── */

  if (prompt.trim().length < 120) {
    findings.push({
      id: "prompt:thin",
      severity: "problem",
      title: "The instructions are very short",
      detail:
        "A few words leaves the agent to invent the rest of the call — its tone, what it asks, and what it will happily promise on your behalf.",
      where: "identity",
      field: "system-prompt",
    })
  }

  // Superseded by the structural check, which recognises any placeholder shape
  // rather than two literal strings, and blocks rather than warns.
  if (false && (prompt.includes("[YOUR COMPANY]") || prompt.includes("[YOUR NAME]"))) {
    findings.push({
      id: "prompt:placeholder",
      severity: "problem",
      title: "The template placeholders are still in",
      detail:
        "The agent will read “[YOUR COMPANY]” out loud, exactly as written.",
      where: "identity",
      field: "system-prompt",
    })
  }

  if (first.trim() && !has(first, ["thank", "hello", "hi", "good morning", "good afternoon", "welcome"])) {
    findings.push({
      id: "first:greeting",
      severity: "suggestion",
      title: "The opening line doesn't greet them",
      detail:
        "The first second of a call decides whether someone stays on it. A plain hello does more than it sounds like it should.",
      where: "identity",
      field: "first-message",
    })
  }

  if (prompt.trim() && !has(prompt, ["never", "do not", "don't", "must not", "avoid"])) {
    findings.push({
      id: "prompt:no-limits",
      severity: "suggestion",
      title: "Nothing is off limits",
      detail:
        "Agents are agreeable by nature. Without an explicit “never quote a price” or “never promise a date”, one eventually will.",
      insert: "Never quote a price, promise a date, or commit to anything on the company's behalf.",
      where: "identity",
      field: "system-prompt",
    })
  }

  /* ── Settings that contradict the setup ──────────────────────────── */

  if (input.config.structuredDataEnabled && !input.config.structuredDataSchema?.trim()) {
    findings.push({
      id: "analysis:no-schema",
      severity: "problem",
      title: "Data extraction is on with nothing to extract",
      detail: "Without a schema describing the fields you want, every call returns nothing.",
      where: "after",
      field: "structured-schema",
    })
  }

  if (input.config.voicemailDetectionEnabled && !input.config.voicemailMessage?.trim()) {
    findings.push({
      id: "voicemail:no-message",
      severity: "suggestion",
      title: "It can detect voicemail but has nothing to say to one",
      detail:
        "It will hang up silently. That's a reasonable choice — but if you'd rather leave a message, write one.",
      where: "conversation",
      field: "voicemail-message",
    })
  }

  if (input.usedForOutbound && !input.config.voicemailDetectionEnabled) {
    findings.push({
      id: "outbound:no-detection",
      severity: "problem",
      title: "This agent runs campaigns but can't spot an answering machine",
      detail:
        "It will hold a full conversation with an answerphone, and that gets recorded as somebody you spoke to. Your campaign results will look better than they are.",
      where: "conversation",
      field: "voicemail-detect",
    })
  }

  if ((input.config.maxTokens ?? 250) > 600) {
    findings.push({
      id: "model:verbose",
      severity: "suggestion",
      title: "Responses can run long",
      detail:
        "On a phone call, a long answer is one the other person talks over. Around 250 keeps it conversational.",
      where: "conversation",
      field: "max-tokens",
    })
  }

  /* ── Nothing to act on ───────────────────────────────────────────── */

  if (enabled.size === 0 && prompt.trim().length > 0) {
    findings.push({
      id: "tools:none",
      severity: "suggestion",
      title: "This agent can talk, but not do anything",
      detail:
        "With no tools switched on, the call leaves nothing behind — no contact, no note, no booking. Fine for a message line; not for anything you want to follow up.",
      where: "tools",
      field: "tools",
    })
  }

  /* ── Is the prompt itself in a fit state? ────────────────────────── */
  //
  // Structure rather than subject: repeated sections, contradictions, length.
  // Kept in its own module because it asks a different question — not "what
  // did you set up that won't happen" but "should this ship at all".
  for (const issue of checkStructure(prompt)) {
    findings.push({
      id: `structure:${issue.id}`,
      severity: issue.blocking ? "blocker" : "problem",
      title: issue.title,
      detail: issue.sample
        ? `${issue.detail} It starts “${issue.sample.slice(0, 70)}${issue.sample.length > 70 ? "…" : ""}”.`
        : issue.detail,
      where: "identity",
      field: "system-prompt",
    })
  }

  // Blockers first, then problems: a list that opens with a suggestion reads as
  // advisory, and the first line of this list is the one people act on.
  const rank = { blocker: 0, problem: 1, suggestion: 2 } as const
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** For the header count. */
export const countBySeverity = (findings: Finding[]) => ({
  blockers:    findings.filter(f => f.severity === "blocker").length,
  problems:    findings.filter(f => f.severity === "problem").length,
  suggestions: findings.filter(f => f.severity === "suggestion").length,
})

export type SeverityCounts = ReturnType<typeof countBySeverity>

/**
 * The one line under "Before you save".
 *
 * A pure function rather than an expression inside the JSX, because the version
 * that lived inside the JSX shipped a real bug: it summed `problems` and
 * `suggestions` and left `blockers` out entirely, so an agent with two things
 * stopping it going live reported **"0 to fix"** directly above two cards
 * describing exactly those two things. The list and the number disagreed, and
 * the number is the part people read.
 *
 * Out here it can be tested, and it is — the first assertion is simply that a
 * summary is never allowed to say zero while findings exist.
 */
export function checkerSummary(counts: SeverityCounts): string {
  const { blockers, problems, suggestions } = counts
  if (blockers + problems + suggestions === 0) return "Nothing to flag."

  return [
    // Named as blocking, not merely counted. "2 to fix" and "2 stopping it
    // going live" ask for different amounts of urgency, and only one of them
    // is true.
    blockers    ? `${blockers} stopping it going live` : "",
    problems    ? `${problems} to fix` : "",
    suggestions ? `${suggestions} to consider` : "",
  ].filter(Boolean).join(" · ")
}

/**
 * The one question the server asks before letting an agent take calls.
 *
 * Exported separately so the routes that put an agent on the air — attaching a
 * number, switching it to Active, starting a campaign — all ask it the same
 * way. A check that only runs in the editor is theatre: the API is what
 * actually publishes.
 */
export function blockersFor(input: CheckInput): Finding[] {
  return checkAgent(input).filter(f => f.severity === "blocker")
}
