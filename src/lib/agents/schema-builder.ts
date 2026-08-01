/**
 * "What to pull out", as a list of fields rather than as JSON Schema.
 *
 * ── WHY ───────────────────────────────────────────────────────────────
 *
 * The extraction settings asked a tenant to write this:
 *
 *     { "type": "object", "properties": { "callerName": { "type": "string" } } }
 *
 * That is a reasonable thing to ask of an engineer and an unreasonable thing to
 * ask of somebody who runs a roofing company, which is who this product is for.
 * A missing brace produces a schema the provider rejects, and the only symptom
 * is that extraction quietly returns nothing on every call — the failure this
 * platform keeps having, in yet another costume.
 *
 * So the tenant names the fields and picks a type, and this turns that into the
 * JSON the provider wants.
 *
 * ── THE HARD PART IS THE WAY BACK ─────────────────────────────────────
 *
 * Agents already exist with schemas typed by hand, and some of them will be
 * more elaborate than a flat list of fields — nested objects, enums, arrays of
 * objects. Rendering one of those as a form would silently destroy it the
 * moment somebody pressed save.
 *
 * So `fromJsonSchema` is honest about what it cannot represent. It returns
 * `simple: false` for anything the form cannot hold, and the editor shows the
 * raw JSON instead, with the reason. Nothing is ever quietly downgraded.
 *
 * ── WHY THESE FIVE TYPES ──────────────────────────────────────────────
 *
 * They are what actually gets extracted from a phone call: a name, a number of
 * something, a yes/no, a date, or a handful of things they mentioned. Offering
 * the full JSON Schema type system would be more complete and would mean
 * explaining `integer` versus `number` to somebody who wants to know how many
 * bedrooms the house has.
 */

export type FieldType = "string" | "number" | "boolean" | "date" | "list"

export type SchemaField = {
  name: string
  type: FieldType
  /**
   * What to look for, in the model's terms.
   *
   * Not decoration. This is the only instruction the model gets about *what*
   * `budget` means, and a field with no description is extracted by guesswork.
   */
  description: string
  required: boolean
}

export const FIELD_TYPES: { value: FieldType; label: string; example: string }[] = [
  { value: "string",  label: "Text",       example: "a name, a postcode, what they asked about" },
  { value: "number",  label: "Number",     example: "a budget, how many bedrooms, a quantity" },
  { value: "boolean", label: "Yes or no",  example: "are they the decision maker, do they own the property" },
  { value: "date",    label: "Date",       example: "when they want the work done" },
  { value: "list",    label: "List",       example: "several things they mentioned, as separate items" },
]

/* ── Names ─────────────────────────────────────────────────────────────── */

/**
 * A key the provider will accept, from whatever somebody typed.
 *
 * People type "Best time to call", and a JSON key with spaces in it is legal
 * but miserable to work with downstream. This lowercases, strips anything that
 * is not a letter, number or space, and camel-cases the rest — so the tenant
 * writes English and the payload gets `bestTimeToCall`.
 */
export function toKey(label: string): string {
  const words = label
    // Apostrophes are removed rather than treated as a break. Replacing them
    // with a space turns "Caller's name" into three words and then into
    // `callerSName`, which is what this did until somebody read the generated
    // key out loud. A possessive is part of the word before it.
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^A-Za-z0-9\s_-]/g, " ")
    .split(/[\s_-]+/)
    .filter(Boolean)

  if (!words.length) return ""

  const [head, ...rest] = words
  return head!.toLowerCase() + rest.map(w => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join("")
}

/* ── Out ───────────────────────────────────────────────────────────────── */

type JsonProp = {
  type: string
  description?: string
  format?: string
  items?: { type: string }
}

/**
 * The provider's payload.
 *
 * Returns `""` — not `"{}"` — when there is nothing to extract. An empty object
 * schema is a valid schema that extracts nothing, and the checker's "extraction
 * is on with nothing to extract" warning keys off the field being blank. `{}`
 * would silence that warning while changing nothing about the outcome.
 */
export function toJsonSchema(fields: SchemaField[]): string {
  const usable = fields.filter(f => toKey(f.name))
  if (!usable.length) return ""

  const properties: Record<string, JsonProp> = {}
  const required: string[] = []

  for (const f of usable) {
    const key = toKey(f.name)
    const prop: JsonProp =
      f.type === "list"    ? { type: "array", items: { type: "string" } }
      : f.type === "date"  ? { type: "string", format: "date" }
      : { type: f.type }

    if (f.description.trim()) prop.description = f.description.trim()
    properties[key] = prop
    if (f.required) required.push(key)
  }

  const schema: Record<string, unknown> = { type: "object", properties }
  if (required.length) schema.required = required

  return JSON.stringify(schema, null, 2)
}

/* ── Back ──────────────────────────────────────────────────────────────── */

export type ParseResult =
  | { simple: true; fields: SchemaField[] }
  /** Why the form cannot hold it, in a sentence a tenant can act on. */
  | { simple: false; reason: string }

/** A key like `bestTimeToCall` shown back as "Best time to call". */
export function fromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

export function fromJsonSchema(raw: string): ParseResult {
  const text = raw.trim()
  if (!text) return { simple: true, fields: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      simple: false,
      reason: "This isn't valid JSON, so it can't be shown as a list of fields. Fix it here, or clear it and start again.",
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { simple: false, reason: "A schema has to be a JSON object." }
  }

  const obj = parsed as Record<string, unknown>

  if (obj.type !== undefined && obj.type !== "object") {
    return { simple: false, reason: "This schema isn't an object, so it can't be shown as a list of fields." }
  }

  const props = obj.properties
  if (props === undefined) return { simple: true, fields: [] }
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return { simple: false, reason: "The properties in this schema aren't in a shape the form can read." }
  }

  const required = new Set(
    Array.isArray(obj.required) ? obj.required.filter((r): r is string => typeof r === "string") : []
  )

  const fields: SchemaField[] = []

  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { simple: false, reason: `“${key}” isn't in a shape the form can read.` }
    }
    const p = value as Record<string, unknown>

    /* Anything richer than a plain typed value is beyond the form. Enums,
     * nested objects and constrained numbers are all legitimate JSON Schema and
     * all things somebody may have written on purpose — so the form declines
     * rather than dropping them. */
    for (const key2 of ["enum", "properties", "oneOf", "anyOf", "allOf", "minimum", "maximum", "pattern"]) {
      if (p[key2] !== undefined) {
        return {
          simple: false,
          reason: `“${key}” uses ${key2}, which the form can't show. Editing it here keeps everything.`,
        }
      }
    }

    let type: FieldType
    if (p.type === "array") {
      const items = p.items as Record<string, unknown> | undefined
      if (!items || items.type !== "string") {
        return { simple: false, reason: `“${key}” is a list of something other than text.` }
      }
      type = "list"
    } else if (p.type === "string") {
      type = p.format === "date" || p.format === "date-time" ? "date" : "string"
    } else if (p.type === "number" || p.type === "integer") {
      type = "number"
    } else if (p.type === "boolean") {
      type = "boolean"
    } else {
      return { simple: false, reason: `“${key}” has a type the form doesn't offer.` }
    }

    fields.push({
      name: fromKey(key),
      type,
      description: typeof p.description === "string" ? p.description : "",
      required: required.has(key),
    })
  }

  return { simple: true, fields }
}

/* ── Starting points ───────────────────────────────────────────────────── */

/**
 * What most people want, so nobody starts at a blank list.
 *
 * An empty form is only marginally better than an empty JSON box: it removes
 * the syntax problem and leaves the "what am I supposed to put here" problem
 * untouched. Three plausible fields answer that in one glance.
 */
export const STARTER_FIELDS: SchemaField[] = [
  { name: "Caller name",   type: "string",  description: "The caller's full name, as they gave it.", required: false },
  { name: "What they want", type: "string", description: "In one sentence, what the caller was asking for.", required: false },
  { name: "Follow up",     type: "boolean", description: "Whether somebody needs to call this person back.", required: false },
]

/** A blank row, for the "add a field" button. */
export const emptyField = (): SchemaField => ({
  name: "", type: "string", description: "", required: false,
})

/* ── What is wrong with it ─────────────────────────────────────────────── */

export type FieldIssue = { index: number; message: string }

/**
 * Problems the provider would reject, or that would silently extract nothing.
 *
 * Checked here rather than on save so they appear as somebody types, and so the
 * same rules apply whether the form or the raw editor produced the schema.
 */
export function fieldIssues(fields: SchemaField[]): FieldIssue[] {
  const issues: FieldIssue[] = []
  const seen = new Map<string, number>()

  fields.forEach((f, i) => {
    const label = f.name.trim()
    if (!label) {
      // A blank row at the end is somebody about to type, not an error.
      if (i < fields.length - 1) issues.push({ index: i, message: "This field needs a name." })
      return
    }

    const key = toKey(label)
    if (!key) {
      issues.push({ index: i, message: "Use letters or numbers in the name." })
      return
    }

    /* Two fields that differ only in punctuation collapse to one key, and the
     * second silently overwrites the first in the payload. */
    const first = seen.get(key)
    if (first !== undefined) {
      issues.push({ index: i, message: `This is the same field as “${fields[first]!.name}” once punctuation is removed.` })
    } else {
      seen.set(key, i)
    }

    if (!f.description.trim()) {
      issues.push({
        index: i,
        message: "Say what to look for — without it the model is guessing what this means.",
      })
    }
  })

  return issues
}
