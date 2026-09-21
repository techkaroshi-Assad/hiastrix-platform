/**
 * GET /api/reports/campaign — the downloadable outbound report.
 *
 *   ?campaignId=<uuid>        one campaign (its whole lifetime unless a
 *                             range is given); omitted = every campaign
 *   ?from=YYYY-MM-DD&to=…     a date range, in the tenant's campaign timezone
 *   ?days=30                  shorthand for the last N days (default when
 *                             nothing else is given and no campaignId)
 *   ?transcripts=1            add the Transcripts sheet (long)
 *
 * Streams an .xlsx. Scoped to the signed-in tenant; a campaignId from
 * another workspace matches nothing and produces an empty workbook rather
 * than an error, same as every other tenant query.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { ERRORS, apiError, sanitiseError } from "@/lib/errors"
import { loadCampaignCallRows } from "@/lib/campaigns/insights"
import { buildCampaignWorkbook } from "@/lib/campaigns/report"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const DAY = 24 * 60 * 60 * 1000
const MAX_DAYS = 366

function parseDay(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)
    const tenantId = ctx.tenant.id

    const q = req.nextUrl.searchParams
    const campaignId = q.get("campaignId")
    if (campaignId && !/^[0-9a-f-]{36}$/i.test(campaignId)) return apiError("That report range isn't valid.", 400)

    const campaign = campaignId
      ? await prisma.campaign.findFirst({
          where: { id: campaignId, tenantId },
          select: { name: true, createdAt: true, timezone: true },
        })
      : null
    if (campaignId && !campaign) return apiError(ERRORS.NOT_FOUND, 404)

    const zoneRow = campaign ?? await prisma.campaign.findFirst({
      where: { tenantId }, orderBy: { createdAt: "desc" }, select: { timezone: true },
    })
    const timeZone = zoneRow?.timezone ?? "UTC"

    const now = new Date()
    let from = parseDay(q.get("from"))
    let to = parseDay(q.get("to"))
    if (to) to = new Date(to.getTime() + DAY - 1)
    if (!from && !to) {
      if (campaign) {
        from = campaign.createdAt
        to = now
      } else {
        const days = Math.min(MAX_DAYS, Math.max(1, Number(q.get("days") ?? "30") || 30))
        from = new Date(now.getTime() - days * DAY)
        to = now
      }
    }
    from ??= new Date(now.getTime() - 30 * DAY)
    to ??= now
    if (to.getTime() - from.getTime() > MAX_DAYS * DAY) return apiError("That report range isn't valid.", 400)

    const withTranscripts = q.get("transcripts") === "1"

    const rows = await loadCampaignCallRows({
      tenantId, campaignId: campaignId ?? undefined, from, to, withTranscript: withTranscripts,
    })

    const title = campaign ? `${campaign.name} — outbound report` : `${ctx.tenant.companyName} — outbound campaigns report`
    const buffer = buildCampaignWorkbook({ rows, title, from, to, timeZone, withTranscripts })

    const stamp = new Date().toISOString().slice(0, 10)
    const base = (campaign?.name ?? "campaigns").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "campaigns"
    const filename = `hiastrix-${base}-${stamp}.xlsx`

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return apiError(sanitiseError(error, "reports/campaign"))
  }
}
