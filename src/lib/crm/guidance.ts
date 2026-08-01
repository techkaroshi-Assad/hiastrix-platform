/**
 * Turning capabilities into behaviour.
 *
 * Switching a tool on tells the agent what it *can* do. It says nothing about
 * when, or in what order — and the wrong order is not a cosmetic problem: create
 * before lookup makes duplicate contacts, and searching for someone you just
 * created finds nothing for about seven seconds and invites making them twice.
 *
 * Two layers, deliberately separate.
 *
 *   enforcedRules()  — appended to every agent's prompt when we build the
 *                      assistant. Short, mechanical, and not the tenant's to
 *                      delete, because breaking these corrupts their data.
 *
 *   suggestedFlow()  — a draft the builder offers to paste into their prompt.
 *                      Conversational, theirs to rewrite or ignore.
 *
 * Client-safe: pure string building, no env, no imports beyond the tool types.
 */

import type { AgentTool, AgentToolType } from "@/lib/vapi/tools"

const has = (tools: AgentTool[], type: AgentToolType) => tools.some(t => t.type === type)
const anyCrm = (tools: AgentTool[]) => tools.some(t => t.type.startsWith("crm."))

/* ── What the agent knows at the moment it picks up ────────────────────── */

/**
 * The date, the time, and who is on the line.
 *
 * A language model has no clock and no caller display. Left unaided it invents
 * both, and it does not invent them plausibly: on a live call placed on 31 July
 * 2026 an agent asked for availability between 3 and 7 **June 2024**, was
 * correctly told there was nothing free, and spent two minutes offering the
 * caller weeks that had already happened. On the same call it asked the caller
 * to spell out an email — because nobody had told it we already held their
 * number — and speech-to-text produced two different addresses across two
 * calls, so the lookup missed and a duplicate contact was created each time.
 *
 * Both are one-line fixes, and both have to be resolved when the call happens
 * rather than when the agent is saved. These are Vapi's own template variables,
 * substituted at call time: bake a real date in here and the agent believes
 * whatever day it was last edited, which is a worse bug than the one being
 * fixed because it degrades silently over months.
 *
 * `{{customer.number}}` is the caller's number on an inbound call and the
 * number dialled on an outbound one — in both cases the other party, which is
 * what we want. It can be empty when a caller withholds their number, so the
 * wording never promises it is there.
 */
function nowBlock(timeZone: string): string {
  const day  = `{{"now" | date: "%A, %B %d, %Y", "${timeZone}"}}`
  const time = `{{"now" | date: "%I:%M %p", "${timeZone}"}}`

  return [
    `Today is ${day}. The time is ${time} (${timeZone}).`,
    "Work out every date the caller mentions from that — \"tomorrow\", \"next week\", \"the 14th\" — and never guess a year.",
    "The other party's number on this call is {{customer.number}}. That line is blank only if they withheld it.",
  ]
    .map(l => `- ${l}`)
    .join("\n")
}

/* ── The non-negotiable part ───────────────────────────────────────────── */

/**
 * Only the rules that prevent damage, and only those relevant to the tools
 * actually switched on. Every extra line here dilutes the tenant's own prompt,
 * so this stays short on purpose.
 */
export function enforcedRules(
  tools: AgentTool[],
  opts: { timeZone?: string } = {}
): string {
  const timeZone = opts.timeZone?.trim() || "UTC"

  // The date and caller block goes to every agent, CRM or not. An agent with no
  // CRM tools at all still gets asked what day Thursday falls on.
  const context = `\n\n---\nRight now (set by Hi-Astrix):\n${nowBlock(timeZone)}`

  if (!anyCrm(tools)) return context

  const lines: string[] = []

  if (has(tools, "crm.contact.find")) {
    lines.push(
      // Named explicitly rather than left as "their phone number", because the
      // agent that failed did have a lookup rule — it just had no number, so it
      // asked, and an email read aloud is the least reliable identifier there is.
      "Look the caller up by the number above before you ask them for anything. Only ask for a phone number or an email address if that number is blank, or if it finds nobody."
    )
  }
  if (has(tools, "crm.contact.create")) {
    lines.push(
      "Only create a contact when the lookup found nobody. Once you create one, use the contact id from that reply for the rest of the call — do not look them up again, and never create the same person twice."
    )
  }
  if (has(tools, "crm.tag.add") || has(tools, "crm.opportunity.stage") || has(tools, "crm.opportunity.create")) {
    lines.push(
      "Use only the exact stage and tag names you are offered. If one is refused, the reply lists the real options — pick from those rather than inventing a name."
    )
  }
  if (has(tools, "crm.appointment.book")) {
    lines.push(
      "Only offer times the availability tool returned, and book using that exact value. Never promise a slot you have not checked."
    )
  }

  /*
   * The honesty rule.
   *
   * On one live call the agent told the caller "I have noted your request for a
   * callback" without ever calling the note tool, and wrote a note saying an
   * appointment was booked for 4pm when no booking tool had been called at all.
   * A model narrates what it intended as though it had happened, and on a phone
   * call nobody can see that it did not — the caller hangs up believing they
   * have an appointment.
   */
  lines.push(
    "Never tell the caller something has been done — booked, noted, tagged, updated, created — unless the tool you used has replied saying it was done. If a tool fails or you have not called it, say you will pass it on instead."
  )

  lines.push("Never read an id, a reference or a system message aloud to the caller.")

  return `${context}\n\nHow to use the CRM (set by Hi-Astrix):\n${lines.map(l => `- ${l}`).join("\n")}`
}

/* ── The editable draft ────────────────────────────────────────────────── */

const STEP: Partial<Record<AgentToolType, string>> = {
  "crm.contact.find":            "Check whether they are already a customer.",
  "crm.contact.create":          "If they are new, take their name and the best number to reach them on, and add them.",
  "crm.contact.update":          "If anything they tell you differs from what is on file, correct it.",
  "crm.contact.field.set":       "Record their answers against the right fields as you go.",
  "crm.appointment.availability":"Check what is genuinely free before you offer any times.",
  "crm.appointment.book":        "Book the slot they choose and read the day and time back to confirm.",
  "crm.opportunity.create":      "If they are genuinely interested, open a deal for them.",
  "crm.opportunity.stage":       "Move their existing deal to reflect how the call actually went.",
  "crm.note.add":                "Before you finish, write a short note covering what they wanted and what you agreed.",
  "crm.tag.add":                 "Tag the outcome so the follow-up runs itself.",
  "crm.tag.remove":              "Clear any tag that no longer describes them.",
}

/** The order a real call happens in, not the order the toggles appear in. */
const ORDER: AgentToolType[] = [
  "crm.contact.find",
  "crm.contact.create",
  "crm.contact.update",
  "crm.contact.field.set",
  "crm.appointment.availability",
  "crm.appointment.book",
  "crm.opportunity.create",
  "crm.opportunity.stage",
  "crm.note.add",
  "crm.tag.add",
  "crm.tag.remove",
]

export function suggestedFlow(tools: AgentTool[]): string {
  const steps = ORDER.filter(type => has(tools, type))
    .map(type => STEP[type])
    .filter((s): s is string => Boolean(s))

  if (!steps.length) return ""

  return [
    "During the call:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Keep it conversational — ask one thing at a time, and never mention that you are updating a system.",
  ].join("\n")
}
