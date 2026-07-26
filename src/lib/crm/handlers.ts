/**
 * What each CRM tool actually does — SERVER ONLY.
 *
 * Every handler returns a short line of plain English, because the return value
 * is spoken. No ids the caller would have to hear, no JSON, no vendor names, and
 * no cheerful confirmation of something that did not happen: several of these
 * endpoints return success for a no-op, so the wording follows what the CRM
 * reports back rather than the status code.
 *
 * A handler never sees the tenant. It is given a locationId the caller already
 * resolved from the assistant, which is what keeps a tool call from reaching
 * another tenant's sub-account.
 */

import {
  crmContacts,
  crmOpportunities,
  crmCalendars,
} from "./client"
import type { AgentTool } from "@/lib/vapi/tools"

type Args = Record<string, unknown>

const text = (args: Args, key: string): string => {
  const v = args[key]
  return typeof v === "string" ? v.trim() : ""
}

/** Emoji and casing are cosmetic; the operator names stages however they like. */
const key = (s: string) =>
  s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
   .replace(/\s+/g, " ")
   .trim()
   .toLowerCase()

const displayName = (c: { firstName?: string; lastName?: string }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "that contact"

/** Midnight UTC for a YYYY-MM-DD. The provider wants epoch milliseconds and
 *  applies the time zone itself when laying out the slots. */
function dayMs(date: string, endOfDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  return endOfDay ? ms + 24 * 60 * 60 * 1000 - 1 : ms
}

export async function runCrmAction(
  tool: AgentTool,
  locationId: string,
  args: Args
): Promise<string> {
  switch (tool.type) {
    /* ── Contacts ──────────────────────────────────────────────────── */

    case "crm.contact.find": {
      const query = text(args, "query")
      if (!query) return "I need a phone number, email address or name to search for."

      /*
       * Exact first, fuzzy second.
       *
       * The free-text search runs off an index that lags about seven seconds
       * behind a write. The duplicate check answers from live data, so anything
       * that looks like an email or a phone number goes there — which is most
       * inbound calls, where we have the caller's number before they speak.
       */
      const exact =
        query.includes("@")     ? await crmContacts.lookupExact(locationId, { email: query }) :
        /^[+\d][\d\s()-]{5,}$/.test(query) ? await crmContacts.lookupExact(locationId, { phone: query }) :
        null

      if (exact) return `Found ${displayName(exact)}, contact id ${exact.id}.`

      const found = await crmContacts.search(locationId, query)
      if (!found.length) {
        return `No existing contact matches "${query}". If they're new, create them rather than searching again.`
      }

      const [first] = found
      const extra = found.length > 1 ? ` (${found.length - 1} other close matches)` : ""
      return `Found ${displayName(first)}, contact id ${first.id}${extra}.`
    }

    case "crm.contact.create": {
      const firstName = text(args, "firstName")
      if (!firstName) return "I need at least a first name to create a contact."

      const created = await crmContacts.create(locationId, {
        firstName,
        ...(text(args, "lastName") ? { lastName: text(args, "lastName") } : {}),
        ...(text(args, "phone")    ? { phone:    text(args, "phone")    } : {}),
        ...(text(args, "email")    ? { email:    text(args, "email")    } : {}),
      })
      return `Created ${firstName}, contact id ${created.id}.`
    }

    case "crm.contact.update": {
      const contactId = text(args, "contactId")
      if (!contactId) return "I need the contact id before I can update anyone."

      const patch: Args = {}
      for (const field of ["firstName", "lastName", "phone", "email"]) {
        if (text(args, field)) patch[field] = text(args, field)
      }
      if (!Object.keys(patch).length) return "Nothing was different, so I left the record as it was."

      await crmContacts.update(locationId, contactId, patch)
      return `Updated their ${Object.keys(patch).length === 1 ? "details" : "details"}.`
    }

    case "crm.contact.field.set": {
      const contactId = text(args, "contactId")
      const field     = text(args, "field")
      const value     = text(args, "value")
      if (!contactId || !field) return "I need the contact and which field to fill in."

      // The model is offered names, never ids, so resolve back here. An empty
      // allow-list means the agent was never given any fields to write.
      const match = tool.fields.find(f => key(f.name) === key(field))
      if (!match) {
        return tool.fields.length
          ? `I can't write to "${field}". The fields available are: ${tool.fields.map(f => f.name).join(", ")}.`
          : "This agent has no fields it is allowed to fill in."
      }

      await crmContacts.update(locationId, contactId, {
        customFields: [{ id: match.id, value }],
      })
      return `Recorded ${match.name}.`
    }

    case "crm.note.add": {
      const contactId = text(args, "contactId")
      const note      = text(args, "note")
      if (!contactId || !note) return "I need the contact and something to write down."

      await crmContacts.addNote(locationId, contactId, note)
      return "Note added to their record."
    }

    /* ── Tags ──────────────────────────────────────────────────────── */

    case "crm.tag.add": {
      const contactId = text(args, "contactId")
      const tag       = text(args, "tag")
      if (!contactId || !tag) return "I need the contact and which tag to apply."

      if (tool.tags.length && !tool.tags.some(t => key(t) === key(tag))) {
        return `I can't apply "${tag}". The tags available are: ${tool.tags.join(", ")}.`
      }

      const added = await crmContacts.addTags(locationId, contactId, [tag])
      // Re-applying an existing tag succeeds with nothing added. Saying "tagged"
      // anyway would claim to have triggered an automation that never fired.
      return added.length ? `Tagged them "${tag}".` : `They already had the "${tag}" tag.`
    }

    case "crm.tag.remove": {
      const contactId = text(args, "contactId")
      const tag       = text(args, "tag")
      if (!contactId || !tag) return "I need the contact and which tag to remove."

      if (tool.tags.length && !tool.tags.some(t => key(t) === key(tag))) {
        return `I can't change "${tag}". The tags available are: ${tool.tags.join(", ")}.`
      }

      const removed = await crmContacts.removeTags(locationId, contactId, [tag])
      return removed.length ? `Removed the "${tag}" tag.` : `They didn't have the "${tag}" tag.`
    }

    /* ── Pipeline ──────────────────────────────────────────────────── */

    case "crm.opportunity.create": {
      const contactId = text(args, "contactId")
      const name      = text(args, "name")
      if (!contactId || !name) return "I need the contact and a name for the deal."

      const pipelines = await crmOpportunities.pipelines(locationId)
      const pipeline  = pipelines.find(p => p.id === tool.pipelineId)
      if (!pipeline || !pipeline.stages.length) {
        return "That pipeline is no longer set up, so I couldn't open a deal."
      }

      const wanted = text(args, "stage")
      const stage  = wanted
        ? pipeline.stages.find(s => key(s.name) === key(wanted))
        : pipeline.stages[0]

      // A wrong guess is answered with the real list so the model can correct
      // itself in the same turn, rather than the config going stale every time
      // someone renames a stage.
      if (!stage) {
        return `"${wanted}" isn't a stage on that pipeline. The stages are: ${pipeline.stages.map(s => s.name).join(", ")}.`
      }

      const value = typeof args.value === "number" ? args.value : undefined

      await crmOpportunities.create(locationId, {
        pipelineId:      pipeline.id,
        pipelineStageId: stage.id,
        contactId,
        name,
        status:          "open",
        ...(value !== undefined ? { monetaryValue: value } : {}),
      })
      return `Opened "${name}" at ${stage.name}.`
    }

    case "crm.opportunity.stage": {
      const contactId = text(args, "contactId")
      const wanted    = text(args, "stage")
      if (!contactId || !wanted) return "I need the contact and which stage to move them to."

      const pipelines = await crmOpportunities.pipelines(locationId)
      const pipeline  = pipelines.find(p => p.id === tool.pipelineId)
      if (!pipeline) return "That pipeline is no longer set up, so I couldn't move anything."

      const stage = pipeline.stages.find(s => key(s.name) === key(wanted))
      if (!stage) {
        return `"${wanted}" isn't a stage on that pipeline. The stages are: ${pipeline.stages.map(s => s.name).join(", ")}.`
      }

      const open = await crmOpportunities.search(locationId, contactId)
      const mine = open.find(o => o.pipelineId === pipeline.id) ?? open[0]
      if (!mine) return "They don't have a deal open yet, so there's nothing to move."

      await crmOpportunities.moveStage(locationId, mine.id, stage.id)
      return `Moved their deal to ${stage.name}.`
    }

    /* ── Appointments ──────────────────────────────────────────────── */

    case "crm.appointment.availability": {
      const start = dayMs(text(args, "startDate"))
      const end   = dayMs(text(args, "endDate"), true)
      if (start === null || end === null) return "I need both dates as year-month-day."
      if (end < start) return "The end date is before the start date."

      const slots = await crmCalendars.freeSlots(locationId, tool.calendarId, {
        startMs:  start,
        endMs:    end,
        timeZone: tool.timeZone,
      })
      if (!slots.length) return "There's nothing free in that range."

      // Only a handful are readable aloud, and the model does not need the rest
      // to offer the caller a choice.
      const shown = slots.slice(0, 8)
      const more  = slots.length - shown.length
      return `Available: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`
    }

    case "crm.appointment.book": {
      const contactId = text(args, "contactId")
      const startTime = text(args, "startTime")
      if (!contactId || !startTime) return "I need the contact and the exact slot to book."

      await crmCalendars.book(locationId, {
        calendarId: tool.calendarId,
        contactId,
        startTime,
        ...(text(args, "title") ? { title: text(args, "title") } : {}),
      })
      return "Booked, and they'll get the confirmation."
    }

    case "function":
      // Custom tools are delivered straight to the tenant's own endpoint and
      // never arrive here.
      return "That tool isn't handled here."
  }
}
