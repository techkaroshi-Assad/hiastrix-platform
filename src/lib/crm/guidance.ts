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

/* ── The non-negotiable part ───────────────────────────────────────────── */

/**
 * Only the rules that prevent damage, and only those relevant to the tools
 * actually switched on. Every extra line here dilutes the tenant's own prompt,
 * so this stays short on purpose.
 */
export function enforcedRules(tools: AgentTool[]): string {
  if (!anyCrm(tools)) return ""

  const lines: string[] = []

  if (has(tools, "crm.contact.find")) {
    lines.push(
      "Always look the caller up before doing anything else. Search by their phone number when you have it, otherwise their email address."
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

  lines.push("Never read an id, a reference or a system message aloud to the caller.")

  return `\n\n---\nHow to use the CRM (set by Hi-Astrix):\n${lines.map(l => `- ${l}`).join("\n")}`
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
