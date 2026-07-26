/**
 * The argument schema each CRM tool presents to the model.
 *
 * The voice provider used to author these for its own native CRM tools. Now that
 * the actions are ours, so are the schemas — and they are the only thing steering
 * the model, so the wording matters as much as the shape.
 *
 * Pure data: no env, no network, no imports beyond the tool types. Both the
 * payload builder and the handler read from here, which is what stops the
 * arguments the model is told about drifting from the ones we actually accept.
 */

import type { AgentTool } from "@/lib/vapi/tools"

type JsonSchema = {
  type: "object"
  properties: Record<string, unknown>
  required?: string[]
}

const CONTACT_ID = {
  type: "string",
  description:
    "The id of the contact, as returned by the contact lookup or creation tool. Never invent one.",
}

const str = (description: string) => ({ type: "string", description })

/**
 * Enumerate when the workspace has restricted the options, otherwise fall back
 * to free text. A tool configured with no allowed tags is permissive by design;
 * an empty `enum` would be rejected by the provider and forbid everything.
 */
const oneOf = (values: string[], description: string) =>
  values.length ? { type: "string", enum: values, description } : str(description)

export function crmToolParameters(tool: AgentTool): JsonSchema {
  switch (tool.type) {
    case "crm.contact.find":
      return {
        type: "object",
        properties: {
          query: str(
            "What to search by — a phone number, an email address, or the caller's full name. Prefer the phone number when you have it."
          ),
        },
        required: ["query"],
      }

    case "crm.contact.create":
      return {
        type: "object",
        properties: {
          // The result carries the new contact's id. The agent must reuse that
          // for everything else on this call — the search index takes several
          // seconds to catch up, so looking them up again comes back empty.
          firstName: str("The caller's first name."),
          lastName:  str("The caller's surname, if they gave one."),
          phone:     str("Their phone number in full international format, for example +14155551234."),
          email:     str("Their email address, if they gave one."),
        },
        required: ["firstName"],
      }

    case "crm.contact.update":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          firstName: str("Corrected first name. Omit unless it changed."),
          lastName:  str("Corrected surname. Omit unless it changed."),
          phone:     str("Corrected phone number. Omit unless it changed."),
          email:     str("Corrected email address. Omit unless it changed."),
        },
        required: ["contactId"],
      }

    case "crm.contact.field.set":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          field: oneOf(
            tool.fields.map(f => f.name),
            "Which field to fill in."
          ),
          value: str("The value to record, exactly as the caller gave it."),
        },
        required: ["contactId", "field", "value"],
      }

    case "crm.note.add":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          note: str(
            "A short factual summary of what was discussed and agreed. Write what the caller said, not your interpretation of it."
          ),
        },
        required: ["contactId", "note"],
      }

    case "crm.tag.add":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          tag: oneOf(tool.tags, "The tag to apply."),
        },
        required: ["contactId", "tag"],
      }

    case "crm.tag.remove":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          tag: oneOf(tool.tags, "The tag to remove."),
        },
        required: ["contactId", "tag"],
      }

    case "crm.opportunity.create":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          name: str("A short title for the deal, usually the caller's name and what they want."),
          // Stages are not enumerated here on purpose — see the handler. A wrong
          // guess comes back with the real list, so the model corrects itself in
          // the same turn instead of the config going stale on every rename.
          stage: str("Which stage of the pipeline to open it in. Leave out to use the first stage."),
          value: { type: "number", description: "Estimated value in whole currency units, if the caller indicated one." },
        },
        required: ["contactId", "name"],
      }

    case "crm.opportunity.stage":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          stage: str("The stage to move the deal to. If you are unsure of the exact name, guess — you will be told the real options."),
        },
        required: ["contactId", "stage"],
      }

    case "crm.appointment.availability":
      return {
        type: "object",
        properties: {
          startDate: str("First date to look at, as YYYY-MM-DD."),
          endDate:   str("Last date to look at, as YYYY-MM-DD. Keep the range to a week or less."),
        },
        required: ["startDate", "endDate"],
      }

    case "crm.appointment.book":
      return {
        type: "object",
        properties: {
          contactId: CONTACT_ID,
          startTime: str(
            "The exact slot to book, in the format returned by the availability tool. Only ever use a value that tool gave you."
          ),
          title: str("A short title for the appointment."),
        },
        required: ["contactId", "startTime"],
      }

    case "function":
      // Custom tools carry a tenant-authored parameter list; the payload builder
      // expands those itself and never reaches this module.
      return { type: "object", properties: {} }
  }
}
