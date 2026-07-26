/**
 * GET /api/admin/crm/locations — sub-accounts available to map to a tenant.
 *
 * Operator-facing, so it returns names rather than making anyone paste an id.
 * Only sub-accounts the app is actually installed on are listed: one it is not
 * installed on cannot be tokenised, so offering it would only produce a tenant
 * whose agent silently fails on its first CRM call.
 */

import { getAdminContext } from "@/lib/admin"
import { crmLocations, crmConfigured } from "@/lib/crm/client"
import { prisma } from "@/lib/prisma"
import { ERRORS, apiError, sanitiseError } from "@/lib/errors"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (!crmConfigured()) return Response.json({ connected: false, locations: [] })

    const connection = await prisma.crmConnection.findUnique({
      where:  { id: true },
      select: { id: true },
    })
    if (!connection) return Response.json({ connected: false, locations: [] })

    const locations = await crmLocations.list()

    // Which sub-accounts are already taken, so the picker can say so rather than
    // letting an operator point two tenants at the same CRM.
    const taken = await prisma.tenant.findMany({
      where:  { crmLocationId: { not: null } },
      select: { id: true, companyName: true, crmLocationId: true },
    })

    return Response.json({
      connected: true,
      locations: locations.map(l => {
        const owner = taken.find((t: { crmLocationId: string | null }) => t.crmLocationId === l.id)
        return { ...l, takenBy: owner ? { id: owner.id, name: owner.companyName } : null }
      }),
    })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/crm/locations/provider"))
  }
}
