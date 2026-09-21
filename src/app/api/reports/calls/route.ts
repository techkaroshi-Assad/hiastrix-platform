/**
 * The calls list, as a file — SERVER ONLY.
 *
 *   ?format=csv | pdf            csv by default
 *   ?from=YYYY-MM-DD&to=…        inclusive, in the tenant's campaign timezone
 *   ?days=N                      shorthand, default 30
 *   ?agent=<id>  ?status=<s>     the same filters the page itself offers
 *
 * ── WHY A SEPARATE ROUTE ──────────────────────────────────────────────
 *
 * The campaign report answers "how did this campaign do". This answers
 * "give me the calls" — every row the Calls page is showing, with the
 * filters that are on screen already applied, because a download that
 * silently ignores the filters above it is worse than no download.
 *
 * CSV is the default and deliberately so: the people asking for this open it
 * in Excel and pivot it. The PDF is the same rows for sending to somebody.
 *
 * Client-safe rules still apply to the PDF — it is a document that leaves the
 * building. Vendor names and raw provider error codes never reach it; every
 * ended reason goes through friendlyEndedReason first.
 */

import { NextRequest } from "next/server"
import { getTenantContext } from "@/lib/tenant"
import { ERRORS, apiError, sanitiseError } from "@/lib/errors"
import { prisma } from "@/lib/prisma"
import { campaignsForCalls } from "@/lib/calls/campaign-link"
import { friendlyEndedReason } from "@/lib/calls/reasons"
import { REACHED_LABEL, type Reached } from "@/lib/calls/reached"
import { Pdf } from "@/lib/pdf"
import { titleCase } from "@/lib/format"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const DAY = 86_400_000
const MAX_DAYS = 400
/** Bounded so a tenant with 100k calls cannot ask for a 40MB PDF. */
const MAX_ROWS = 5_000

function dayStart(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const guess = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(guess.getTime())) return null
  // Shift the UTC midnight by the zone's offset on that date.
  const local = new Date(guess.toLocaleString("en-US", { timeZone }))
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }))
  return new Date(guess.getTime() + (utc.getTime() - local.getTime()))
}

/** RFC 4180: quote everything, double the quotes inside. Excel-safe. */
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v)
  return `"${s.replace(/"/g, '""')}"`
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
    const format = q.get("format") === "pdf" ? "pdf" : "csv"
    const now = new Date()

    let from = q.get("from") ? dayStart(q.get("from")!, timeZone) : null
    let to = q.get("to") ? dayStart(q.get("to")!, timeZone) : null
    if ((q.get("from") && !from) || (q.get("to") && !to)) {
      return apiError("That date range isn't valid.", 400)
    }
    if (to) to = new Date(Math.min(now.getTime(), to.getTime() + DAY - 1))
    if (!from && !to) {
      const days = Math.min(MAX_DAYS, Math.max(1, Number(q.get("days") ?? "30") || 30))
      from = new Date(now.getTime() - days * DAY)
      to = now
    }
    from ??= new Date((to ?? now).getTime() - 30 * DAY)
    to ??= now
    if (to < from || to.getTime() - from.getTime() > MAX_DAYS * DAY) {
      return apiError("That date range isn't valid.", 400)
    }

    // The same filters the page carries, so the file matches the screen.
    const agentId = q.get("agent")
    const status  = q.get("status")
    const where = {
      tenantId,
      createdAt: { gte: from, lte: to },
      ...(agentId ? { agentId } : {}),
      ...(status ? { status: status as never } : {}),
    }

    const calls = await prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      include: {
        agent:       { select: { name: true } },
        phoneNumber: { select: { phoneNumber: true } },
      },
    })

    const campaigns = await campaignsForCalls(
      tenantId,
      calls.map(c => c.vapiCallId).filter((v): v is string => Boolean(v))
    )

    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
    const when = (d: Date | null) => (d ? fmt.format(d) : "")

    const rows = calls.map(c => {
      const camp = c.vapiCallId ? campaigns.get(c.vapiCallId) : undefined
      return {
        when:     when(c.startedAt ?? c.createdAt),
        campaign: camp?.campaignName ?? "",
        lead:     camp?.leadName ?? "",
        agent:    c.agent?.name ?? "",
        from:     c.phoneNumber?.phoneNumber ?? "",
        to:       c.callerNumber ?? "",
        direction: titleCase(c.direction),
        status:   titleCase(c.status),
        reached:  c.reached ? (REACHED_LABEL[c.reached as Reached] ?? c.reached) : "",
        seconds:  c.durationSeconds,
        minutes:  c.minutesBilled,
        ended:    c.endedReason ? friendlyEndedReason(c.endedReason) : "",
        summary:  c.summary ?? "",
      }
    })

    const stamp = (d: Date) => d.toISOString().slice(0, 10)
    const base =
      ctx.tenant.companyName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "workspace"
    const name = `hiastrix-${base}-calls-${stamp(from)}-to-${stamp(to)}`

    if (format === "csv") {
      const header = [
        "When", "Campaign", "Name on list", "Agent", "From", "To", "Direction",
        "Status", "Who picked up", "Duration (s)", "Minutes billed",
        "Ended because", "Summary",
      ]
      const body = rows.map(r => [
        r.when, r.campaign, r.lead, r.agent, r.from, r.to, r.direction,
        r.status, r.reached, r.seconds, r.minutes, r.ended, r.summary,
      ])
      // BOM first: without it Excel on Windows mangles any non-ASCII name.
      const csv = "﻿" + [header, ...body].map(line => line.map(csvCell).join(",")).join("\r\n")

      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}.csv"`,
          "Cache-Control": "no-store",
        },
      })
    }

    const pdf = new Pdf({ title: `${ctx.tenant.companyName} — calls`, author: "Hi-Astrix" })
    pdf.heading(`${ctx.tenant.companyName} — calls`)
    pdf.paragraph(
      `${rows.length.toLocaleString()} call${rows.length === 1 ? "" : "s"} · ` +
      `${when(from)} to ${when(to)} (${timeZone})` +
      (rows.length === MAX_ROWS ? ` · showing the most recent ${MAX_ROWS.toLocaleString()}` : ""),
      { size: 9 }
    )
    pdf.table({
      // Widths are fractions of the content width, not points.
      columns: [
        { header: "When",          width: 15 },
        { header: "Campaign",      width: 16 },
        { header: "Agent",         width: 10 },
        { header: "To",            width: 13 },
        { header: "Who picked up", width: 12 },
        { header: "Status",        width: 10 },
        { header: "Mins",          width: 6, align: "right" },
        { header: "Ended because", width: 18 },
      ],
      rows: rows.map(r => [r.when, r.campaign, r.agent, r.to, r.reached, r.status, r.minutes, r.ended]),
      zebra: true,
    })

    return new Response(new Uint8Array(pdf.finish()), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    return apiError(sanitiseError(err), 500)
  }
}
