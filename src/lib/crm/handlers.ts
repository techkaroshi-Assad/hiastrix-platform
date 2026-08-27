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

/**
 * The same idea, spelled any of the ways a model spells it.
 *
 * `key` keeps punctuation, which is right when comparing names a person typed.
 * For tags it is too strict: `Callback Requested`, `callback-requested` and
 * `callback_requested` are one tag to a human and three rows in the CRM, and a
 * campaign filtering on one of them silently matches none of the others. This
 * strips everything that is not a letter or a digit so a near-match can be
 * snapped onto the tag the workspace actually configured.
 */
const loose = (s: string) => key(s).replace(/[^a-z0-9]+/g, "")

/**
 * The same number, written the ways a CRM might hold it.
 *
 * We always have E.164 — `+13133986372` — because that is what the telephony
 * provider hands us. A CRM record typed in by a human very often is not: it is
 * `(313) 398-6372`, or `0313 398 6372`, or the number with no country code at
 * all. The duplicate-detection endpoint matches on what it is given, so one
 * format is one guess, and a guess that misses reads exactly like a person who
 * is not there — which is how a caller we already had ended up with a second
 * record.
 *
 * Deliberately short. Each variant is a round trip, the voice provider gives a
 * tool call eight seconds in total, and the last ten digits catch essentially
 * every case the full E.164 form misses. Beyond that the returns vanish and the
 * latency does not.
 */
export function phoneVariants(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  const digits = trimmed.replace(/\D/g, "")
  const out = [trimmed]

  // The subscriber part, which is what a locally-typed record usually holds.
  if (digits.length > 10) {
    const last10 = digits.slice(-10)
    if (last10 !== trimmed) out.push(last10)
  }

  return out
}

const displayName = (c: { firstName?: string; lastName?: string }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "that contact"

/**
 * What a found contact is tagged, spoken rather than left implicit.
 *
 * The enforced rule tells the agent to use whatever the lookup actually
 * returned rather than assume anything about a caller it just identified —
 * tags are the one piece of that beyond a name and an id, and omitting them
 * here would leave the instruction with nothing to act on.
 */
const tagSuffix = (c: { tags?: string[] }) =>
  c.tags?.length ? ` Tagged: ${c.tags.join(", ")}.` : ""

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
      let exact = null
      if (query.includes("@")) {
        exact = await crmContacts.lookupExact(locationId, { email: query })
      } else if (/^[+\d][\d\s()-]{5,}$/.test(query)) {
        // Every plausible spelling of the number, stopping at the first hit —
        // we hold E.164 and the record may not.
        for (const phone of phoneVariants(query)) {
          exact = await crmContacts.lookupExact(locationId, { phone })
          if (exact) break
        }
      }

      if (exact) return `Found ${displayName(exact)}, contact id ${exact.id}.${tagSuffix(exact)}`

      const found = await crmContacts.search(locationId, query)
      if (!found.length) {
        return `No existing contact matches "${query}". If they're new, create them rather than searching again.`
      }

      const [first] = found
      const extra = found.length > 1 ? ` (${found.length - 1} other close matches)` : ""
      return `Found ${displayName(first)}, contact id ${first.id}${extra}.${tagSuffix(first)}`
    }

    case "crm.contact.create": {
      const firstName = text(args, "firstName")
      if (!firstName) return "I need at least a first name to create a contact."

      /*
       * Check for the person again, here, immediately before creating them.
       *
       * The prompt already says to look first and only create on a miss, and on
       * two live calls the agent did exactly that and still produced duplicate
       * records — because the lookup it ran was against a mis-heard email, and
       * a lookup that misses is indistinguishable from a person who is not
       * there. An instruction cannot fix that; only asking again, with the
       * identifiers actually being written, can.
       *
       * This uses the duplicate-detection endpoint, which answers from live
       * data rather than the search index that lags a write by seven seconds —
       * so unlike `search`, it also catches the case where this same call
       * created them moments ago.
       *
       * Email and phone are checked separately, not together: a caller may give
       * a number we hold and an email we do not, and a combined query would
       * find nobody and make a second record for someone we already have.
       */
      const phone = text(args, "phone")
      const email = text(args, "email")

      for (const by of [
        ...phoneVariants(phone).map(p => ({ phone: p })),
        ...(email ? [{ email }] : []),
      ]) {
        const existing = await crmContacts.lookupExact(locationId, by)
        if (existing) {
          return `${displayName(existing)} is already in the CRM, contact id ${existing.id}. Use that — don't create them again.`
        }
      }

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
      const raw       = text(args, "tag")
      if (!contactId || !raw) return "I need the contact and which tag to apply."

      /*
       * Snap to the configured spelling before anything else.
       *
       * `Callback Requested`, `callback requested` and `callback-requested` are
       * three rows in the CRM and one idea. Campaigns filter contacts by an
       * exact tag, so a variant is a contact the campaign will never find —
       * which is precisely how tag sourcing came to work on one account and
       * return nobody on another. Snapping happens whether or not new tags are
       * allowed: a near-match is always meant to be the listed tag.
       */
      const listed = tool.tags.find(t => loose(t) === loose(raw))
      const tag    = listed ?? raw

      if (!listed && !tool.allowNewTags) {
        return tool.tags.length
          ? `I can't apply "${raw}". The tags available are: ${tool.tags.join(", ")}.`
          : `I can't apply "${raw}" — no tags have been set up for me to use.`
      }

      const added = await crmContacts.addTags(locationId, contactId, [tag])
      // Re-applying an existing tag succeeds with nothing added. Saying "tagged"
      // anyway would claim to have triggered an automation that never fired.
      return added.length ? `Tagged them "${tag}".` : `They already had the "${tag}" tag.`
    }

    case "crm.tag.remove": {
      const contactId = text(args, "contactId")
      const raw       = text(args, "tag")
      if (!contactId || !raw) return "I need the contact and which tag to remove."

      // Always restricted, with no opt-out — see the schema. Removing a tag
      // nobody listed is at best a no-op and at worst strips one an automation
      // depends on.
      const listed = tool.tags.find(t => loose(t) === loose(raw))
      if (!listed) {
        return tool.tags.length
          ? `I can't change "${raw}". The tags available are: ${tool.tags.join(", ")}.`
          : `I can't change "${raw}" — no tags have been set up for me to use.`
      }

      const removed = await crmContacts.removeTags(locationId, contactId, [listed])
      return removed.length ? `Removed the "${listed}" tag.` : `They didn't have the "${listed}" tag.`
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

      /*
       * A range that has already happened is answered with the date, not with
       * "nothing free".
       *
       * On a live call placed on 31 July 2026 the agent asked for slots between
       * 3 and 7 June **2024**, because a language model has no clock and had
       * been told nothing. The calendar answered truthfully that nothing was
       * free, so the model concluded the diary was full, offered week after
       * week — each one also in 2024 — and the caller was told there was no
       * availability at all. The agent is now given the date in its prompt,
       * which is the real fix; this is the backstop, because "nothing free" is
       * an answer that hides the mistake instead of surfacing it.
       *
       * Same self-correcting shape as a wrong pipeline stage: say what was
       * wrong and what the truth is, and the model fixes itself in the same
       * turn rather than repeating the question.
       */
      const today = new Date()
      const todayStart = Date.UTC(
        today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()
      )
      if (end < todayStart) {
        const readable = new Date(todayStart).toISOString().slice(0, 10)
        return `That range is in the past — today is ${readable}. Ask again using dates from today onwards.`
      }

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
