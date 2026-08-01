/**
 * GET /api/admin/crm/locations — sub-accounts available to map to a tenant.
 *
 * Operator-facing, so it returns names rather than making anyone paste an id.
 * Only sub-accounts the app is actually installed on are listed: one it is not
 * installed on cannot be tokenised, so offering it would only produce a tenant
 * whose agent silently fails on its first CRM call.
 *
 * Always answers 200, carrying a `problem` when it cannot help. An operator
 * staring at an empty picker needs to know *which* of three things is wrong —
 * missing configuration, no connection, or the CRM refusing the request — and a
 * failed fetch that the client renders as "not connected" sends them to the
 * wrong screen.
 */

import { getAdminContext } from "@/lib/admin"
import { crmLocations, crmConfigured } from "@/lib/crm/client"
import { prisma } from "@/lib/prisma"
import { ERRORS, apiError } from "@/lib/errors"

export const dynamic = "force-dynamic"

type Problem = "unconfigured" | "disconnected" | "unavailable"

const nothing = (problem: Problem, detail?: string) =>
  Response.json({ connected: false, problem, detail, locations: [] })

export async function GET() {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (!crmConfigured()) return nothing("unconfigured")
    if (!process.env.CRM_APP_ID) {
      return nothing("unconfigured", "CRM_APP_ID is not set on this environment.")
    }

    const connection = await prisma.crmConnection.findFirst({
      where:  { id: true },
      select: { id: true },
    })
    if (!connection) return nothing("disconnected")

    let locations
    try {
      locations = await crmLocations.list()
    } catch (error) {
      // Logged in full, summarised for the operator. This is the case that used
      // to masquerade as "not connected".
      console.error("[admin/crm/locations]", error)
      return nothing("unavailable", "The CRM refused the request. The connection may need reconnecting.")
    }

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
    console.error("[admin/crm/locations]", error)
    return nothing("unavailable")
  }
}
