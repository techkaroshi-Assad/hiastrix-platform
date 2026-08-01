/**
 * Agent tools — schema, catalogue and validation.
 *
 * Client-safe: no env reads, no server imports. This is deliberately the single
 * source of truth shared by the form builder, the JSON editor and the API
 * routes. Two definitions would drift, and the drift would only surface as a
 * provider rejection after the tenant had already hit save.
 *
 * Every CRM action is a `crm.*` type of our own. They used to be the voice
 * provider's native CRM tool types, which bound to one credential connected at
 * the *organisation* level — so every tenant's agent wrote into the same CRM
 * account. These run against our own endpoint instead, which resolves the tenant
 * from the assistant that placed the call and acts only on that tenant's
 * sub-account.
 *
 * The names are also deliberately vendor-free. A tenant can open the JSON editor
 * and read this config; nothing in it should tell them what we run underneath.
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

/* ── CRM actions ───────────────────────────────────────────────────────── */

/**
 * An id chosen from a dropdown.
 *
 * Deliberately allows the empty string. Requiring it here would mean a tenant
 * who switches an action on and has not yet picked a pipeline gets a raw schema
 * error naming an internal path — `config.tools.7.pipelineId` — at save time.
 * Emptiness is a cross-field concern instead, reported by `toolIssues` in plain
 * English against the action it belongs to, live in the form.
 */
const ID     = z.string().max(120).default("")
const LABELS = z.array(z.string().min(1).max(100)).max(50).default([])

/** No configuration — the endpoint knows the tenant, and the model supplies the
 *  rest as arguments. */
const plain = <T extends string>(type: T) => z.object({ type: z.literal(type), ...identity })

export const CrmContactFindSchema   = plain("crm.contact.find")
export const CrmContactCreateSchema = plain("crm.contact.create")
export const CrmContactUpdateSchema = plain("crm.contact.update")
export const CrmNoteAddSchema       = plain("crm.note.add")

/**
 * Restricted to the fields the workspace chose.
 *
 * Both halves are stored because they serve different readers: the model is
 * offered the human `name`, since asking it to pick an opaque id invites
 * hallucination, and the handler resolves that back to the `id` the CRM wants.
 */
export const CrmFieldSetSchema = z.object({
  type: z.literal("crm.contact.field.set"),
  ...identity,
  fields: z.array(z.object({
    id:   z.string().min(1).max(120),
    name: z.string().min(1).max(120),
  })).max(30).default([]),
})

/**
 * Tags are the lever into workflows the operator built by hand, so the allowed
 * list is a real safety boundary: whatever is named here is what the agent can
 * trigger. An empty list means any tag, which is rarely what anyone wants.
 */
export const CrmTagAddSchema = z.object({
  type: z.literal("crm.tag.add"),
  ...identity,
  tags: LABELS,
  /**
   * Whether the agent may invent a tag that is not on the list.
   *
   * This used to be implied by the list being empty, and that was the bug. An
   * empty list switched the allow-list check off entirely while the tool
   * description still told the model "only the tags listed for this agent are
   * allowed" — so the model believed it was constrained, was not, and minted
   * `No Appointment Booked`, `Callback Requested` and `Booked` across two live
   * calls. Campaigns pull contacts from the CRM *by tag*, so every invented
   * variant is a contact the campaign filter will never match: it works on the
   * account whose tags were typed by hand and silently returns nobody on the
   * next one.
   *
   * Off is the default and the safe setting. On means the listed tags are
   * preferred rather than mandatory — a tag that merely differs in case or
   * punctuation is still snapped to the listed spelling, because two spellings
   * of one tag is the failure this exists to prevent.
   */
  allowNewTags: z.boolean().default(false),
})

export const CrmTagRemoveSchema = z.object({
  type: z.literal("crm.tag.remove"),
  ...identity,
  tags: LABELS,
  // Deliberately no `allowNewTags`. Removal is destructive and inventing a name
  // to remove is meaningless — at best a no-op, at worst it strips a tag some
  // automation depends on. Removal is always restricted to the list.
})

export const CrmOpportunityCreateSchema = z.object({
  type: z.literal("crm.opportunity.create"),
  ...identity,
  pipelineId: ID,
})

export const CrmOpportunityStageSchema = z.object({
  type: z.literal("crm.opportunity.stage"),
  ...identity,
  pipelineId: ID,
})

export const CrmAvailabilitySchema = z.object({
  type: z.literal("crm.appointment.availability"),
  ...identity,
  calendarId: ID,
  timeZone:   z.string().max(64).default("UTC"),
})

export const CrmBookSchema = z.object({
  type: z.literal("crm.appointment.book"),
  ...identity,
  calendarId: ID,
})

export const AgentToolSchema = z.discriminatedUnion("type", [
  FunctionToolSchema,
  CrmContactFindSchema,
  CrmContactCreateSchema,
  CrmContactUpdateSchema,
  CrmFieldSetSchema,
  CrmNoteAddSchema,
  CrmTagAddSchema,
  CrmTagRemoveSchema,
  CrmOpportunityCreateSchema,
  CrmOpportunityStageSchema,
  CrmAvailabilitySchema,
  CrmBookSchema,
])

export type AgentTool     = z.infer<typeof AgentToolSchema>
export type AgentToolType = AgentTool["type"]

export const isCrmTool = (t: AgentTool): boolean => t.type.startsWith("crm.")

/* ── Reading what is already stored ────────────────────────────────────── */

/**
 * The four provider-native CRM types this replaced.
 *
 * Kept as a translation table rather than as union members, so the schema stays
 * clean while stored rows still convert. An agent carrying one of these picks up
 * its replacement on the next read and persists it on the next save, with
 * nothing visible happening to the tenant.
 */
const LEGACY_TYPES: Record<string, AgentToolType> = {
  "gohighlevel.contact.get":                  "crm.contact.find",
  "gohighlevel.contact.create":               "crm.contact.create",
  "gohighlevel.calendar.availability.check":  "crm.appointment.availability",
  "gohighlevel.calendar.event.create":        "crm.appointment.book",
}

/**
 * Parse a stored tool list, element-wise.
 *
 * Element-wise matters more than it looks. `readConfig` falls back to defaults
 * for the *whole* config when a parse fails, so one unrecognised tool would
 * otherwise reset temperature, prompts and twenty-odd unrelated fields on the
 * next render — and persist that on the next save. Dropping the single bad
 * entry keeps the blast radius to the thing that is actually wrong.
 */
export function normaliseTools(raw: unknown): AgentTool[] {
  if (!Array.isArray(raw)) return []

  const out: AgentTool[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue

    const record = entry as Record<string, unknown>
    const legacy = typeof record.type === "string" ? LEGACY_TYPES[record.type] : undefined
    const candidate = legacy ? { ...record, type: legacy } : record

    const parsed = AgentToolSchema.safeParse(candidate)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/* ── Catalogue for the builder UI ──────────────────────────────────────── */

export type CrmToolGroup = "contacts" | "pipeline" | "appointments"

export type CrmToolSpec = {
  type: Exclude<AgentToolType, "function">
  group: CrmToolGroup
  label: string
  blurb: string
  defaultName: string
  defaultDescription: string
  needsCalendar?: boolean
  needsTimeZone?: boolean
  needsPipeline?: boolean
  needsTags?: boolean
  needsFields?: boolean
}

export const CRM_GROUPS: { key: CrmToolGroup; title: string; blurb: string }[] = [
  {
    key: "contacts",
    title: "Contacts",
    blurb: "Finding the caller, recording what they said, and tagging them so your automations pick it up.",
  },
  {
    key: "pipeline",
    title: "Pipeline",
    blurb: "Opening a deal and moving it along the stages you have already built.",
  },
  {
    key: "appointments",
    title: "Appointments",
    blurb: "Reading real availability and booking on a calendar.",
  },
]

export const CRM_TOOLS: CrmToolSpec[] = [
  {
    type: "crm.contact.find",
    group: "contacts",
    label: "Look up a contact",
    blurb: "Find whether the caller is already in the CRM, by phone, email or name.",
    defaultName: "find_contact",
    defaultDescription:
      "Look up an existing contact in the CRM by phone number, email address or name. Use this first, before creating anyone new. Give the phone number or email when you have one — a name is a fuzzy match.",
  },
  {
    type: "crm.contact.create",
    group: "contacts",
    label: "Create a contact",
    blurb: "Add a new lead during the call.",
    defaultName: "create_contact",
    defaultDescription:
      "Create a new contact in the CRM with the caller's name and contact details, once you have confirmed they are not already there. Remember the contact id it returns and use that for the rest of the call — do not look them up again.",
  },
  {
    type: "crm.contact.update",
    group: "contacts",
    label: "Update contact details",
    blurb: "Correct a name, email or phone number the caller confirms.",
    defaultName: "update_contact",
    defaultDescription:
      "Update an existing contact's name, email address or phone number after the caller has confirmed the correct value.",
  },
  {
    type: "crm.contact.field.set",
    group: "contacts",
    label: "Fill in a custom field",
    blurb: "Writes an answer onto the contact in your CRM, in a field you created.",
    defaultName: "set_contact_field",
    defaultDescription:
      "Record an answer against one of the workspace's custom contact fields.",
    needsFields: true,
  },
  {
    type: "crm.note.add",
    group: "contacts",
    label: "Add a note",
    blurb: "Write what happened on the call onto the contact.",
    defaultName: "add_note",
    defaultDescription:
      "Add a note to the contact summarising what was discussed and agreed on this call.",
  },
  {
    type: "crm.tag.add",
    group: "contacts",
    label: "Put a tag on",
    blurb: "Tags the contact when the call ends a certain way, so your existing workflows take over.",
    defaultName: "add_tag",
    defaultDescription:
      "Apply a tag to the contact to record the outcome of the call. Only the tags listed for this agent are allowed.",
    needsTags: true,
  },
  {
    type: "crm.tag.remove",
    group: "contacts",
    label: "Take a tag off",
    blurb: "Clears a tag that no longer describes them. Pair it with “Put a tag on” to swap one for another.",
    defaultName: "remove_tag",
    defaultDescription:
      "Remove a tag from the contact when it no longer describes them — for example when their situation has changed and a different tag now applies. Only the tags listed for this agent can be removed.",
    needsTags: true,
  },
  {
    type: "crm.opportunity.create",
    group: "pipeline",
    label: "Open a deal",
    blurb: "Create an opportunity in a pipeline you have built.",
    defaultName: "create_opportunity",
    defaultDescription:
      "Create a new opportunity for this contact in the pipeline, when the caller shows genuine interest.",
    needsPipeline: true,
  },
  {
    type: "crm.opportunity.stage",
    group: "pipeline",
    label: "Move a deal's stage",
    blurb: "Advance an existing deal to a different stage.",
    defaultName: "move_opportunity_stage",
    defaultDescription:
      "Move the contact's existing opportunity to a different stage of the pipeline based on how the call went.",
    needsPipeline: true,
  },
  {
    type: "crm.appointment.availability",
    group: "appointments",
    label: "Check availability",
    blurb: "Read genuinely open slots before offering any times.",
    defaultName: "check_availability",
    defaultDescription:
      "Check which appointment slots are actually free on the calendar for a given date range, before offering the caller any times.",
    needsCalendar: true,
    needsTimeZone: true,
  },
  {
    type: "crm.appointment.book",
    group: "appointments",
    label: "Book an appointment",
    blurb: "Place a booking for a contact at an agreed time.",
    defaultName: "book_appointment",
    defaultDescription:
      "Book an appointment on the calendar for this contact at a time you have already confirmed is available.",
    needsCalendar: true,
  },
]

/** Booking needs a contact to book for, so it cannot stand alone. */
export const BOOKING_PREREQUISITES: AgentToolType[] = [
  "crm.contact.find",
  "crm.contact.create",
]

export const BOOKING_PREREQ_MESSAGE =
  "Booking needs to find or create the caller's contact first, so “Look up a contact” and “Create a contact” have to be on as well."

const LOOKUP_REQUIRED_MESSAGE =
  "Every CRM action needs a contact to act on, so “Look up a contact” has to be on as well."

/* ── Validation shared by the schema and the live form ─────────────────── */

export type ToolIssue = { path: (string | number)[]; message: string }

/**
 * Pure so the form can show the same problem the server would reject, before
 * the tenant hits save.
 */
export function toolIssues(tools: AgentTool[]): ToolIssue[] {
  const issues: ToolIssue[] = []
  const has = (t: AgentToolType) => tools.some(x => x.type === t)

  /*
   * Availability is the one CRM action that reads the calendar rather than a
   * contact, so it is the only one that can stand on its own.
   */
  const needsLookup = tools.findIndex(
    t => isCrmTool(t) &&
         t.type !== "crm.contact.find" &&
         t.type !== "crm.appointment.availability"
  )
  if (needsLookup !== -1 && !has("crm.contact.find")) {
    issues.push({ path: [needsLookup], message: LOOKUP_REQUIRED_MESSAGE })
  }

  /*
   * A dropdown left unchosen. Caught here rather than by the field schema so the
   * tenant reads "Choose a pipeline for Open a deal" instead of a path into our
   * config object — and reads it while editing, not after pressing save.
   */
  tools.forEach((t, i) => {
    const spec = CRM_TOOLS.find(s => s.type === t.type)
    if (!spec) return

    if (spec.needsCalendar && !(t as { calendarId?: string }).calendarId) {
      issues.push({
        path: [i, "calendarId"],
        message: `Choose a calendar for “${spec.label}”.`,
      })
    }
    if (spec.needsPipeline && !(t as { pipelineId?: string }).pipelineId) {
      issues.push({
        path: [i, "pipelineId"],
        message: `Choose a pipeline for “${spec.label}”.`,
      })
    }
  })

  const bookingIndex = tools.findIndex(t => t.type === "crm.appointment.book")
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
        issues.push({ path: [i, "type"], message: "That action is already added." })
      }
      seenType.add(tool.type)
    }
  })

  return issues
}

/* ── Helpers for the builder ───────────────────────────────────────────── */

export function defaultCrmTool(spec: CrmToolSpec): AgentTool {
  const base = { name: spec.defaultName, description: spec.defaultDescription }

  switch (spec.type) {
    case "crm.appointment.availability":
      return { type: spec.type, ...base, calendarId: "", timeZone: "America/New_York" }
    case "crm.appointment.book":
      return { type: spec.type, ...base, calendarId: "" }
    case "crm.opportunity.create":
    case "crm.opportunity.stage":
      return { type: spec.type, ...base, pipelineId: "" }
    // Split, because only adding carries the permissive flag. A new tag tool
    // starts restricted — the tenant opts in to invention rather than out of it.
    case "crm.tag.add":
      return { type: spec.type, ...base, tags: [], allowNewTags: false }
    case "crm.tag.remove":
      return { type: spec.type, ...base, tags: [] }
    case "crm.contact.field.set":
      return { type: spec.type, ...base, fields: [] }
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
