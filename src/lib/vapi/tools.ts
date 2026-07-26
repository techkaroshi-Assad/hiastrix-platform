/**
 * Agent tools — schema, catalogue and validation.
 *
 * Client-safe: no env reads, no server imports. This is deliberately the single
 * source of truth shared by the form builder, the JSON editor and the API
 * routes. Two definitions would drift, and the drift would only surface as a
 * provider rejection after the tenant had already hit save.
 *
 * The discriminator `type` uses the provider's exact wire strings so someone
 * reading the JSON can match it against the upstream docs. Note that the inner
 * shape is NOT wire-identical: `parameters` here is a typed list, which we
 * expand into JSON Schema when building the payload. Pasting a provider tool
 * definition in verbatim will therefore be rejected — by design, since a silent
 * partial accept is worse than a clear error.
 */

import { z } from "zod"

/* ── Custom function tools ─────────────────────────────────────────────── */

export const TOOL_PARAM_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
] as const

/** Model-facing identifiers: letters, digits, underscore, dash. */
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/
const IDENT_MSG = "Use letters, numbers, underscores and dashes, starting with a letter."

const ToolParameterSchema = z.object({
  name:        z.string().regex(IDENT, IDENT_MSG),
  type:        z.enum(TOOL_PARAM_TYPES).default("string"),
  description: z.string().max(300).default(""),
  required:    z.boolean().default(false),
})

export type ToolParameter = z.infer<typeof ToolParameterSchema>

/** Every tool carries the name and description the model reasons about. */
const identity = {
  name:        z.string().regex(IDENT, IDENT_MSG),
  description: z.string().min(1).max(500),
}

export const FunctionToolSchema = z.object({
  type: z.literal("function"),
  ...identity,
  parameters: z.array(ToolParameterSchema).max(20).default([]),
  /**
   * Required, not optional.
   *
   * A function tool with no destination is routed by the provider to the
   * *assistant-level* server block — ours — as a `tool-calls` message we do not
   * subscribe to and could not answer. The call then hangs mid-sentence.
   * Making this required means every function tool names its own endpoint.
   */
  serverUrl:      z.string().url().startsWith("https://", "Use an https:// address."),
  serverSecret:   z.string().max(200).default(""),
  waitingMessage: z.string().max(200).default(""),
})

/* ── GoHighLevel ───────────────────────────────────────────────────────── */

export const GhlContactGetSchema = z.object({
  type: z.literal("gohighlevel.contact.get"),
  ...identity,
})

export const GhlContactCreateSchema = z.object({
  type: z.literal("gohighlevel.contact.create"),
  ...identity,
})

export const GhlAvailabilitySchema = z.object({
  type: z.literal("gohighlevel.calendar.availability.check"),
  ...identity,
  calendarId: z.string().min(1).max(120),
  // Capital Z: that is the metadata key the provider expects.
  timeZone:   z.string().min(1).max(64),
})

export const GhlEventCreateSchema = z.object({
  type: z.literal("gohighlevel.calendar.event.create"),
  ...identity,
  calendarId: z.string().min(1).max(120),
})

export const AgentToolSchema = z.discriminatedUnion("type", [
  FunctionToolSchema,
  GhlContactGetSchema,
  GhlContactCreateSchema,
  GhlAvailabilitySchema,
  GhlEventCreateSchema,
])

export type AgentTool     = z.infer<typeof AgentToolSchema>
export type AgentToolType = AgentTool["type"]

/* ── Catalogue for the builder UI ──────────────────────────────────────── */

export type GhlToolSpec = {
  type: Exclude<AgentToolType, "function">
  label: string
  blurb: string
  defaultName: string
  defaultDescription: string
  needsCalendar: boolean
  needsTimeZone: boolean
}

export const GHL_TOOLS: GhlToolSpec[] = [
  {
    type: "gohighlevel.contact.get",
    label: "Look up a contact",
    blurb: "Find someone already in the CRM by phone or email.",
    defaultName: "get_crm_contact",
    defaultDescription:
      "Look up an existing contact in the CRM using their phone number or email address.",
    needsCalendar: false,
    needsTimeZone: false,
  },
  {
    type: "gohighlevel.contact.create",
    label: "Create a contact",
    blurb: "Add a new person to the CRM during the call.",
    defaultName: "create_crm_contact",
    defaultDescription:
      "Create a new contact in the CRM with the caller's name and contact details.",
    needsCalendar: false,
    needsTimeZone: false,
  },
  {
    type: "gohighlevel.calendar.availability.check",
    label: "Check availability",
    blurb: "Read open slots from a calendar before offering times.",
    defaultName: "check_calendar_availability",
    defaultDescription:
      "Check which appointment slots are available on the calendar for a given date range.",
    needsCalendar: true,
    needsTimeZone: true,
  },
  {
    type: "gohighlevel.calendar.event.create",
    label: "Book an appointment",
    blurb: "Place a booking on the calendar for a known contact.",
    defaultName: "book_appointment",
    defaultDescription:
      "Book an appointment on the calendar for the caller at an agreed time.",
    needsCalendar: true,
    needsTimeZone: false,
  },
]

/** Booking needs a contactId, so it cannot stand alone. */
export const BOOKING_PREREQUISITES: AgentToolType[] = [
  "gohighlevel.contact.get",
  "gohighlevel.contact.create",
]

export const BOOKING_PREREQ_MESSAGE =
  "Booking needs to find or create the caller's contact first, so “Look up a contact” and “Create a contact” have to be on as well."

/* ── Validation shared by the schema and the live form ─────────────────── */

export type ToolIssue = { path: (string | number)[]; message: string }

/**
 * Pure so the form can show the same problem the server would reject, before
 * the tenant hits save.
 */
export function toolIssues(tools: AgentTool[]): ToolIssue[] {
  const issues: ToolIssue[] = []
  const has = (t: AgentToolType) => tools.some(x => x.type === t)

  const bookingIndex = tools.findIndex(
    t => t.type === "gohighlevel.calendar.event.create"
  )
  if (bookingIndex !== -1 && !BOOKING_PREREQUISITES.every(has)) {
    issues.push({ path: [bookingIndex], message: BOOKING_PREREQ_MESSAGE })
  }

  const seenName = new Set<string>()
  const seenType = new Set<string>()

  tools.forEach((tool, i) => {
    if (seenName.has(tool.name)) {
      issues.push({
        path: [i, "name"],
        message: `Two tools are both named “${tool.name}”. Names must be unique.`,
      })
    }
    seenName.add(tool.name)

    // Integrations are singletons; only custom functions can repeat.
    if (tool.type !== "function") {
      if (seenType.has(tool.type)) {
        issues.push({ path: [i, "type"], message: "That integration is already added." })
      }
      seenType.add(tool.type)
    }
  })

  return issues
}

/* ── Helpers for the builder ───────────────────────────────────────────── */

export function defaultGhlTool(spec: GhlToolSpec): AgentTool {
  const base = { name: spec.defaultName, description: spec.defaultDescription }

  switch (spec.type) {
    case "gohighlevel.calendar.availability.check":
      return { type: spec.type, ...base, calendarId: "", timeZone: "America/New_York" }
    case "gohighlevel.calendar.event.create":
      return { type: spec.type, ...base, calendarId: "" }
    default:
      return { type: spec.type, ...base }
  }
}

export function blankFunctionTool(index: number): AgentTool {
  return {
    type: "function",
    name: `custom_tool_${index + 1}`,
    description: "",
    parameters: [],
    serverUrl: "",
    serverSecret: "",
    waitingMessage: "",
  }
}

export const findTool = (tools: AgentTool[], type: AgentToolType) =>
  tools.find(t => t.type === type)

export const removeToolType = (tools: AgentTool[], type: AgentToolType) =>
  tools.filter(t => t.type !== type)

export function upsertTool(tools: AgentTool[], next: AgentTool): AgentTool[] {
  if (next.type === "function") return tools
  const i = tools.findIndex(t => t.type === next.type)
  if (i === -1) return [...tools, next]
  const copy = [...tools]
  copy[i] = next
  return copy
}

/** A short IANA list for the picker; the field also accepts free text. */
export const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
] as const
