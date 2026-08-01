/**
 * GET /api/crm/options — everything the agent builder needs to render real
 * dropdowns instead of asking anyone to paste an id.
 *
 * One round trip rather than four, because the builder needs all of it at once
 * and each call costs a CRM request. Scoped to the signed-in tenant's own
 * sub-account; the location is read from our database, never from the request.
 *
 * ── Why this file now reports failures ─────────────────────────────────────
 *
 * It used to answer an empty list for four completely different situations:
 * the platform having no CRM credentials, the tenant having no sub-account
 * mapped, the provider refusing the call, and the sub-account genuinely having
 * nothing. All four rendered in the builder as "No tags in your CRM yet".
 *
 * A tenant whose sub-account holds nineteen tags and fifty-two custom fields
 * was shown "you have none" of both, and there was no way — from the screen or
 * from the response — to tell that anything had gone wrong. Every list now
 * carries why it is empty, so "nothing there" and "we could not look" stop
 * being the same sentence.
 *
 * What goes back to the browser stays vendor-free: a status word we chose, and
 * never the provider's own message. The real error goes to the server log.
 */

import { getTenantContext } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import {
  crmConfigured,
  crmCalendars,
  crmOpportunities,
  crmMeta,
} from "@/lib/crm/client"
import { ERRORS, apiError, sanitiseError } from "@/lib/errors"

export const dynamic = "force-dynamic"

/**
 * Why a list is the way it is.
 *
 *   ok           the list is what the sub-account holds, empty or not
 *   unavailable  we asked and could not get an answer
 *   not_linked   this workspace has no sub-account mapped yet
 *   unconfigured the platform itself has no CRM credentials
 */
export type OptionStatus = "ok" | "unavailable" | "not_linked" | "unconfigured"

const emptyWith = (status: OptionStatus) => ({
  linked: false,
  status,
  calendars: [], pipelines: [], tags: [], fields: [],
  failed: [] as string[],
})

/**
 * Run one list, and say which it was if it fails.
 *
 * The provider's message is logged and never returned — a tenant should not
 * learn what we run underneath from a dropdown that would not load.
 */
async function settle<T>(name: string, work: Promise<T[]>): Promise<{ name: string; rows: T[]; ok: boolean }> {
  try {
    return { name, rows: await work, ok: true }
  } catch (error) {
    console.error(`[crm/options] ${name}`, error)
    return { name, rows: [], ok: false }
  }
}

export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (!crmConfigured()) return Response.json(emptyWith("unconfigured"))

    const tenant = await prisma.tenant.findUnique({
      where:  { id: ctx.tenant.id },
      select: { crmLocationId: true },
    })
    const locationId = tenant?.crmLocationId
    if (!locationId) return Response.json(emptyWith("not_linked"))

    // One slow list must not blank the other three, so each is settled
    // independently — but a failure is now recorded rather than swallowed.
    const [calendars, pipelines, tags, fields] = await Promise.all([
      settle("calendars", crmCalendars.list(locationId)),
      settle("pipelines", crmOpportunities.pipelines(locationId)),
      settle("tags",      crmMeta.tags(locationId)),
      settle("fields",    crmMeta.customFields(locationId)),
    ])

    const failed = [calendars, pipelines, tags, fields].filter(r => !r.ok).map(r => r.name)

    return Response.json({
      linked: true,
      status: (failed.length ? "unavailable" : "ok") satisfies OptionStatus,
      /** Which of the four could not be read, by name. */
      failed,
      calendars: calendars.rows,
      pipelines: pipelines.rows,
      tags:      tags.rows,
      fields:    fields.rows.map(f => ({ id: f.id, name: f.name })),
    })
  } catch (error) {
    return apiError(sanitiseError(error, "crm/options/provider"))
  }
}
