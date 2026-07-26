/**
 * GET /api/crm/options — everything the agent builder needs to render real
 * dropdowns instead of asking anyone to paste an id.
 *
 * One round trip rather than four, because the builder needs all of it at once
 * and each call costs a CRM request. Scoped to the signed-in tenant's own
 * sub-account; the location is read from our database, never from the request.
 *
 * Degrades quietly. A tenant with no sub-account mapped, or an environment with
 * no CRM connected, gets `linked: false` and empty lists — the builder then
 * explains the situation rather than showing four empty selects.
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

const EMPTY = { linked: false, calendars: [], pipelines: [], tags: [], fields: [] }

export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (!crmConfigured()) return Response.json(EMPTY)

    const tenant = await prisma.tenant.findUnique({
      where:  { id: ctx.tenant.id },
      select: { crmLocationId: true },
    })
    const locationId = tenant?.crmLocationId
    if (!locationId) return Response.json(EMPTY)

    // One slow list should not blank the other three, so each is settled
    // independently and a failure degrades to empty.
    const [calendars, pipelines, tags, fields] = await Promise.all([
      crmCalendars.list(locationId).catch(() => []),
      crmOpportunities.pipelines(locationId).catch(() => []),
      crmMeta.tags(locationId).catch(() => []),
      crmMeta.customFields(locationId).catch(() => []),
    ])

    return Response.json({
      linked: true,
      calendars,
      pipelines,
      tags,
      fields: fields.map(f => ({ id: f.id, name: f.name })),
    })
  } catch (error) {
    return apiError(sanitiseError(error, "crm/options/provider"))
  }
}
