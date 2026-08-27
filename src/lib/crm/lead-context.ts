/**
 * One canonical fact-set about who is on the other end of a call — SERVER ONLY.
 *
 * Built the same way regardless of where the person came from — an uploaded
 * spreadsheet, a CRM tag pull, or a live lookup run just before dialling — so
 * "what does the agent get told about this person" has exactly one
 * implementation to get right, and exactly one place to extend later (an
 * order history flag, a loyalty tier) without touching the dialer, the
 * inbound prompt, and the campaign override separately and letting them
 * drift apart.
 *
 * The output is deliberately two things, not one:
 *
 *   variableValues — for `{{...}}` substitution, used only where the
 *                    tenant's own prompt happens to reference it.
 *
 *   promptBlock    — stated outright, and paired with an explicit rule that
 *                    anything not listed is unknown. A variable sitting
 *                    unused in `variableValues` cannot stop a model from
 *                    inventing a detail; a sentence telling it what it does
 *                    and does not know can.
 */

import { crmConfigured, crmContacts, type CrmContact } from "./client"
import { phoneVariants } from "./handlers"

export type LeadContext = {
  /** Best-known personal name — CSV-supplied, or the CRM record's, in that order. */
  name: string | null
  /** Business/company, kept separate from personal name on purpose: a caller is
   *  often calling on behalf of somewhere, not just for themselves. */
  business: string | null
  /** Only set when a CRM record was actually found. Never fabricated. */
  crm: { contactId: string; tags: string[] } | null
  /** Anything else known — unmapped CSV columns — keyed by their own normalised
   *  header. Free-form, because the source (a tenant's spreadsheet) is. */
  extra: Record<string, string>
}

/**
 * Look a phone number up in the tenant's CRM, tolerating everything.
 *
 * Best-effort and bounded: called from two places with very different failure
 * budgets — the dialer's per-lead tick, and (eventually) an inbound ring with
 * roughly seven seconds total before the provider gives up — and in neither
 * one may a slow or broken CRM stop a call from happening. A timeout or an
 * error here means "we don't know who this is", nothing more.
 */
export async function lookupCrmContact(
  locationId: string | null,
  phoneE164: string,
  timeoutMs: number
): Promise<CrmContact | null> {
  if (!locationId || !phoneE164 || !crmConfigured()) return null

  const search = (async () => {
    for (const phone of phoneVariants(phoneE164)) {
      const found = await crmContacts.lookupExact(locationId, { phone })
      if (found) return found
    }
    return null
  })()

  try {
    return await Promise.race([
      search,
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])
  } catch {
    return null
  }
}

/**
 * The same idea for a lead that already carries a CRM contact id — a tag
 * pull, or a previous call's lookup written back onto the row (see
 * lib/dialer/dial.ts). A direct read by id, so it is used instead of
 * `lookupCrmContact` rather than alongside it, not in addition to a phone
 * search: we already know exactly who this is.
 */
export async function lookupCrmContactById(
  locationId: string | null,
  contactId: string,
  timeoutMs: number
): Promise<CrmContact | null> {
  if (!locationId || !contactId || !crmConfigured()) return null

  try {
    return await Promise.race([
      crmContacts.get(locationId, contactId),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])
  } catch {
    return null
  }
}

/**
 * Merge whatever is known into one shape.
 *
 * `fields` rides in from a CSV import or a CRM tag pull and may already carry
 * a `business` key (see lib/dialer/csv.ts) — promoted to its own field here
 * rather than left duplicated in `extra`.
 */
export function buildLeadContext(a: {
  name?: string | null
  fields?: Record<string, unknown>
  crmContact?: CrmContact | null
}): LeadContext {
  const fields = a.fields ?? {}
  const extra: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (k === "business" || k === "email") continue
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s) extra[k] = s
  }

  const contact = a.crmContact ?? null
  const crmName = contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim()
    : ""
  const business = typeof fields.business === "string" ? fields.business.trim() : ""

  return {
    name: a.name?.trim() || crmName || null,
    business: business || null,
    crm: contact ? { contactId: contact.id, tags: contact.tags ?? [] } : null,
    extra,
  }
}

export function formatLeadContext(ctx: LeadContext): {
  variableValues: Record<string, string>
  promptBlock: string
} {
  const variableValues: Record<string, string> = {
    name: ctx.name ?? "",
    business: ctx.business ?? "",
    ...ctx.extra,
  }

  const facts: string[] = []
  if (ctx.name) facts.push(`Their name is ${ctx.name}.`)
  if (ctx.business) facts.push(`They're associated with "${ctx.business}".`)
  if (ctx.crm) {
    facts.push("They already exist in the CRM — this is not a new lead.")
    if (ctx.crm.tags.length) facts.push(`Their current tags: ${ctx.crm.tags.join(", ")}.`)
  }
  for (const [k, v] of Object.entries(ctx.extra)) facts.push(`${k}: ${v}.`)

  const promptBlock = facts.length
    ? [
        "What you know about who you're speaking with, before the call starts:",
        ...facts.map(f => `- ${f}`),
        "Treat the above as fact and nothing else as fact. Anything about them not listed here is unknown to you — ask, never guess or assume.",
      ].join("\n")
    : "You have no prior information about who you're speaking with. Don't guess their name, their business, or their history — ask."

  return { variableValues, promptBlock }
}
