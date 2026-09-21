/**
 * GET /api/reports/activity — the tenant activity report as a PDF.
 *
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   inclusive, in the tenant's campaign
 *                                    timezone; default the last 30 days
 *   ?days=N                          shorthand
 *   ?audience=internal               adds provider detail, end reasons and
 *                                    billing; default is the client-safe
 *                                    version with none of that
 *
 * Everything the workspace did in the window: every call, campaign
 * outcomes, callbacks, objections, agents, cost. Works for any tenant with
 * no per-tenant setup — it reads the same tables the dashboard reads.
 */

import { NextRequest } from "next/server"
import { getTenantContext } from "@/lib/tenant"
import { ERRORS, apiError, sanitiseError } from "@/lib/errors"
import { loadActivityReport, renderActivityPdf } from "@/lib/reports/activity"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const DAY = 24 * 60 * 60 * 1000
const MAX_DAYS = 366

/** Midnight at the start of `YYYY-MM-DD` in `timeZone`, as a UTC instant. */
function dayStart(s: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const guess = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(guess.getTime())) return null
  // Find the zone's offset at that moment and shift the guess by it.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(guess)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0")
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"))
  const offset = local - guess.getTime()
  return new Date(guess.getTime() - offset)
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)
    const tenantId = ctx.tenant.id

    const zoneRow = await prisma.campaign.findFirst({
      where: { tenantId }, orderBy: { createdAt: "desc" }, select: { timezone: true },
    })
    const timeZone = zoneRow?.timezone ?? "UTC"

    const q = req.nextUrl.searchParams
    const now = new Date()
    let from = q.get("from") ? dayStart(q.get("from")!, timeZone) : null
    let to = q.get("to") ? dayStart(q.get("to")!, timeZone) : null
    if ((q.get("from") && !from) || (q.get("to") && !to)) return apiError("That report range isn't valid.", 400)
    if (to) to = new Date(Math.min(now.getTime(), to.getTime() + DAY - 1))
    if (!from && !to) {
      const days = Math.min(MAX_DAYS, Math.max(1, Number(q.get("days") ?? "30") || 30))
      from = new Date(now.getTime() - days * DAY)
      to = now
    }
    from ??= new Date((to ?? now).getTime() - 30 * DAY)
    to ??= now
    if (to < from || to.getTime() - from.getTime() > MAX_DAYS * DAY) return apiError("That report range isn't valid.", 400)

    const audience = q.get("audience") === "internal" ? "internal" : "client"

    /*
     * Scope to one campaign when asked.
     *
     * Checked against this tenant before use — a campaign id is a plain URL
     * parameter, and without the ownership check it would read another
     * workspace's calls into a PDF.
     */
    const wantCampaign = q.get("campaignId")
    let campaignId: string | undefined
    let campaignName: string | undefined
    if (wantCampaign) {
      const owned = await prisma.campaign.findFirst({
        where: { id: wantCampaign, tenantId },
        select: { id: true, name: true },
      })
      if (!owned) return apiError("That campaign isn't available.", 404)
      campaignId = owned.id
      campaignName = owned.name
    }

    const report = await loadActivityReport({ tenantId, campaignId, from, to, timeZone })
    const pdf = renderActivityPdf(report, { audience })

    const stamp = (d: Date) => d.toISOString().slice(0, 10)
    const base = ctx.tenant.companyName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "workspace"
    // The campaign in the filename, so a folder of these stays sortable and
    // nobody has to open three PDFs to find the one they meant.
    const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()
    const scope = campaignName ? `-${slug(campaignName).slice(0, 40)}` : "-activity"
    const filename = `hiastrix-${base}${scope}-${stamp(from)}-to-${stamp(to)}${audience === "internal" ? "-internal" : ""}.pdf`

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return apiError(sanitiseError(error, "reports/activity"))
  }
}
