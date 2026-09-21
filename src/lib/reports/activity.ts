/**
 * The tenant activity report — SERVER ONLY.
 *
 * "Everything that happened between these two dates", for one tenant, as a
 * PDF somebody can email to a client or put in a board pack. Built from the
 * same two sources the dashboard renders — lib/analytics.ts for every call
 * and lib/campaigns/insights.ts for campaign outcomes — so a number in the
 * PDF is the number on the screen, for any tenant, with no per-tenant code.
 *
 * `loadActivityReport` gathers; `renderActivityPdf` draws. The seam is a
 * plain data object so the renderer can be exercised without a database.
 */

import { prisma } from "@/lib/prisma"
import { loadAnalytics, safeZone, type Range } from "@/lib/analytics"
import { loadCampaignCallRows, rollup, total, callbacksDue, type CampaignOutcomes, type CallOutcomeRow } from "@/lib/campaigns/insights"
import { REACHED_LABEL, type Reached } from "@/lib/calls/reached"
import { friendlyEndedReason } from "@/lib/calls/reasons"
import { Pdf, type RGB } from "@/lib/pdf"

export type ActivityReport = {
  tenantName: string
  from: Date
  to: Date
  timeZone: string
  generatedAt: Date
  totals: {
    calls: number
    humans: number
    minutes: number
    costCents: number
    medianHumanSeconds: number
    p90HumanSeconds: number
  }
  byDirection: { key: string; calls: number }[]
  reached: Record<Reached, number>
  series: { day: string; calls: number; humans: number }[]
  agents: { name: string; calls: number; humans: number; minutes: number; costCents: number }[]
  endedReasons: { label: string; calls: number }[]
  campaigns: CampaignOutcomes[]
  campaignTotal: CampaignOutcomes
  callbacks: CallOutcomeRow[]
  objections: { text: string; count: number }[]
  keyFacts: string[]
  /** How many campaign calls had the outbound extraction — the "not recorded" denominator. */
  extractedShare: { extracted: number; humans: number }
}

export async function loadActivityReport(a: {
  tenantId: string
  from: Date
  to: Date
  timeZone?: string
}): Promise<ActivityReport> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
    select: { companyName: true },
  })
  const zoneRow = a.timeZone
    ? null
    : await prisma.campaign.findFirst({ where: { tenantId: a.tenantId }, orderBy: { createdAt: "desc" }, select: { timezone: true } })
  const timeZone = safeZone(a.timeZone ?? zoneRow?.timezone ?? "UTC")

  const days = Math.max(1, Math.round((a.to.getTime() - a.from.getTime()) / 86_400_000))
  const range: Range = { from: a.from, to: a.to, days }

  const [an, rows, reachedRows] = await Promise.all([
    loadAnalytics(a.tenantId, range, timeZone),
    loadCampaignCallRows({ tenantId: a.tenantId, from: a.from, to: a.to }),
    prisma.$queryRaw<{ reached: string | null; n: bigint }[]>`
      SELECT reached, count(*)::bigint AS n FROM calls
       WHERE tenant_id = ${a.tenantId}::uuid AND created_at >= ${a.from} AND created_at <= ${a.to}
       GROUP BY reached
    `,
  ])

  const reached: Record<Reached, number> = { HUMAN: 0, IVR: 0, VOICEMAIL: 0, NO_ANSWER: 0, FAILED: 0 }
  for (const r of reachedRows) {
    const k = (r.reached ?? "NO_ANSWER") as Reached
    if (k in reached) reached[k] += Number(r.n)
  }

  // Objections, grouped loosely: lower-cased, punctuation stripped, first 60 chars.
  const objMap = new Map<string, { text: string; count: number }>()
  for (const r of rows) {
    if (!r.objection) continue
    const key = r.objection.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().slice(0, 60)
    if (!key) continue
    const e = objMap.get(key)
    if (e) e.count++
    else objMap.set(key, { text: r.objection, count: 1 })
  }
  const objections = [...objMap.values()].sort((x, y) => y.count - x.count).slice(0, 12)

  const keyFacts = rows.flatMap(r => r.keyFacts).filter(Boolean).slice(0, 30)

  const campaigns = [...rollup(rows).values()].sort((x, y) => y.dials - x.dials)
  const campaignTotal = total(rows)

  return {
    tenantName: tenant.companyName,
    from: a.from,
    to: a.to,
    timeZone,
    generatedAt: new Date(),
    totals: {
      calls: an.totals.calls,
      humans: an.totals.connected,
      minutes: an.totals.minutes,
      costCents: an.totals.costCents,
      medianHumanSeconds: an.medianSeconds,
      p90HumanSeconds: an.p90Seconds,
    },
    byDirection: an.byDirection,
    reached,
    series: an.series.map(s => ({ day: s.day, calls: s.calls, humans: s.connected })),
    agents: an.byAgent.map(r => ({ name: r.name, calls: r.calls, humans: r.connected, minutes: r.minutes, costCents: r.costCents })),
    endedReasons: an.byEndedReason.map(r => ({ label: friendlyEndedReason(r.key, s => s), calls: r.calls })),
    campaigns,
    campaignTotal,
    callbacks: callbacksDue(rows).slice(0, 40),
    objections,
    keyFacts,
    extractedShare: { extracted: campaignTotal.extracted, humans: campaignTotal.reached.HUMAN },
  }
}

/* ── Rendering ─────────────────────────────────────────────────────────── */

const BRAND: RGB = [111, 84, 220]
const MUTED: RGB = [110, 108, 130]
const GREEN: RGB = [34, 150, 94]
const AMBER: RGB = [214, 140, 30]
const GREY: RGB = [170, 168, 184]
const RED: RGB = [200, 60, 60]

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—")
const mmss = (s: number) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`

export function renderActivityPdf(r: ActivityReport): Buffer {
  const fmtDay = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: r.timeZone, year: "numeric", month: "long", day: "numeric" }).format(d)
  const fmtStamp = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("en-US", { timeZone: r.timeZone, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : ""

  const pdf = new Pdf({ title: `${r.tenantName} — activity report`, size: "A4", margin: 46 })
  const answered = r.reached.HUMAN + r.reached.IVR + r.reached.VOICEMAIL

  /* ── Cover block ──────────────────────────────────────────────────── */
  pdf.rect(pdf.margin, pdf.margin, pdf.contentWidth, 96, { fill: [40, 32, 90] })
  pdf.text("HI-ASTRIX", pdf.margin + 18, pdf.margin + 24, { size: 8, font: "bold", colour: [200, 190, 255] })
  pdf.text(`${r.tenantName}`, pdf.margin + 18, pdf.margin + 52, { size: 22, font: "bold", colour: [255, 255, 255], maxWidth: pdf.contentWidth - 36 })
  pdf.text("Activity report", pdf.margin + 18, pdf.margin + 72, { size: 12, colour: [225, 220, 255] })
  pdf.text(`${fmtDay(r.from)} to ${fmtDay(r.to)}`, pdf.width - pdf.margin - 18, pdf.margin + 52, { size: 10, colour: [225, 220, 255], align: "right" })
  pdf.text(`Generated ${fmtStamp(r.generatedAt)} (${r.timeZone.replace(/_/g, " ")})`, pdf.width - pdf.margin - 18, pdf.margin + 72, { size: 8, colour: [200, 190, 255], align: "right" })
  pdf.y = pdf.margin + 96 + 18

  /* ── Headline ─────────────────────────────────────────────────────── */
  pdf.heading("At a glance")
  pdf.kpis([
    { label: "Calls", value: r.totals.calls.toLocaleString(), sub: `${r.byDirection.map(d => `${d.calls} ${d.key.toLowerCase()}`).join(" · ")}` },
    { label: "Reached a person", value: pct(r.totals.humans, r.totals.calls), sub: `${r.totals.humans.toLocaleString()} calls a person answered` },
    { label: "Minutes billed", value: r.totals.minutes.toLocaleString(), sub: r.totals.medianHumanSeconds ? `typical conversation ${mmss(r.totals.medianHumanSeconds)}` : undefined },
    { label: "Charged", value: usd(r.totals.costCents), sub: r.totals.humans ? `${usd(Math.round(r.totals.costCents / r.totals.humans))} per person reached` : undefined },
  ])

  const ct = r.campaignTotal
  if (ct.dials > 0) {
    pdf.kpis([
      { label: "Campaign dials", value: ct.dials.toLocaleString(), sub: `${ct.peopleReached} people reached` },
      { label: "Decision-makers", value: ct.decisionMakers.toLocaleString(), sub: ct.reached.HUMAN ? `${pct(ct.decisionMakers, ct.reached.HUMAN)} of people reached` : undefined },
      { label: "Interested", value: (ct.interest.interested + ct.interest.maybe).toLocaleString(), sub: `${ct.interest.interested} yes · ${ct.interest.maybe} maybe · ${ct.interest["not-interested"]} no` },
      { label: "Callbacks owed", value: ct.callbacksRequested.toLocaleString(), sub: ct.decisionMakers ? `${usd(Math.round(ct.costCents / ct.decisionMakers))} per decision-maker` : undefined },
    ])
  }

  pdf.paragraph(
    `"Reached a person" counts calls where someone actually spoke. A phone menu, a voicemail greeting or a ring-out is not a conversation, however long the call lasted. ` +
    `${r.reached.IVR} call${r.reached.IVR === 1 ? "" : "s"} in this period reached only an automated menu and ${r.reached.VOICEMAIL} reached voicemail.`,
    { size: 8.5, colour: MUTED }
  )

  /* ── What picked up ───────────────────────────────────────────────── */
  pdf.heading("What picked up", { size: 12 })
  const reachedRows: { label: string; value: number; colour: RGB }[] = [
    { label: REACHED_LABEL.HUMAN, value: r.reached.HUMAN, colour: GREEN },
    { label: REACHED_LABEL.IVR, value: r.reached.IVR, colour: AMBER },
    { label: REACHED_LABEL.VOICEMAIL, value: r.reached.VOICEMAIL, colour: [190, 160, 60] },
    { label: REACHED_LABEL.NO_ANSWER, value: r.reached.NO_ANSWER, colour: GREY },
    { label: REACHED_LABEL.FAILED, value: r.reached.FAILED, colour: RED },
  ]
  pdf.bars(reachedRows, { format: v => `${v} (${pct(v, r.totals.calls)})`, max: r.totals.calls })
  if (ct.ivrSeen > 0) {
    pdf.paragraph(`A phone menu answered on ${ct.ivrSeen} of ${answered} answered campaign calls; ${Math.max(0, ct.ivrSeen - ct.reached.IVR)} of those still got through to a person.`, { size: 8.5, colour: MUTED })
  }

  /* ── Daily volume ─────────────────────────────────────────────────── */
  pdf.heading("Calls per day", { size: 12 })
  pdf.columns(r.series.map(s => ({ label: s.day.slice(5), value: s.calls })), { format: v => `${v} calls` })
  pdf.paragraph("People reached per day", { size: 8, colour: MUTED, gapAfter: 2 })
  pdf.columns(r.series.map(s => ({ label: s.day.slice(5), value: s.humans })), { height: 50, colour: GREEN, format: v => `${v}` })

  /* ── Campaigns ────────────────────────────────────────────────────── */
  if (r.campaigns.length) {
    pdf.newPage()
    pdf.heading("Campaigns")
    if (r.extractedShare.humans > 0 && r.extractedShare.extracted === 0) {
      pdf.paragraph(
        "Interest, decision-maker and callback figures show as 0 because the campaign agent was not set up to record them during this period. " +
        "Switch on the \"Outbound cold call\" extraction preset on the agent and these fill in for every call from then on.",
        { size: 8.5, colour: AMBER }
      )
    }
    pdf.table({
      columns: [
        { header: "Campaign", width: 1.55 },
        { header: "Dials", width: 0.6, align: "right" },
        { header: "People", width: 0.7, align: "right" },
        { header: "Reached", width: 0.75, align: "right" },
        { header: "Menu only", width: 0.8, align: "right" },
        { header: "Voicemail", width: 0.85, align: "right" },
        { header: "Decision-makers", width: 1.25, align: "right" },
        { header: "Interested", width: 0.9, align: "right" },
        { header: "Callbacks", width: 0.85, align: "right" },
        { header: "Charged", width: 0.8, align: "right" },
      ],
      size: 7.5,
      rows: [
        ...r.campaigns.map(c => [
          c.campaignName, c.dials, c.peopleReached, pct(c.reached.HUMAN, c.dials), c.reached.IVR, c.reached.VOICEMAIL,
          c.decisionMakers, c.interest.interested + c.interest.maybe, c.callbacksRequested, usd(c.costCents),
        ]),
        ...(r.campaigns.length > 1
          ? [["All campaigns", ct.dials, ct.peopleReached, pct(ct.reached.HUMAN, ct.dials), ct.reached.IVR, ct.reached.VOICEMAIL,
              ct.decisionMakers, ct.interest.interested + ct.interest.maybe, ct.callbacksRequested, usd(ct.costCents)]]
          : []),
      ],
      zebra: true,
      boldLast: r.campaigns.length > 1,
    })

    // Only when the extraction actually ran — a chart of zeros says
    // nothing the warning above didn't.
    if (ct.reached.HUMAN > 0 && ct.extracted > 0) {
      pdf.heading("Where the conversations went", { size: 12 })
      pdf.bars([
        { label: "Reached the decision-maker", value: ct.decisionMakers, colour: GREEN },
        { label: "Stopped at reception", value: ct.gatekeepers, colour: AMBER },
        { label: "Interested", value: ct.interest.interested, colour: GREEN },
        { label: "Maybe / later", value: ct.interest.maybe, colour: [190, 160, 60] },
        { label: "Not interested", value: ct.interest["not-interested"], colour: GREY },
        { label: "Interest not recorded", value: ct.interest.unknown, colour: [210, 208, 220] },
        { label: "Asked for a callback", value: ct.callbacksRequested, colour: BRAND },
        { label: "Asked to be removed", value: ct.nextAction["remove-from-list"], colour: RED },
      ], { max: ct.reached.HUMAN, format: v => `${v} (${pct(v, ct.reached.HUMAN)})`, labelWidth: 150 })
    }

    if (r.objections.length) {
      pdf.heading("What people said no to", { size: 12 })
      pdf.bars(r.objections.map(o => ({ label: o.text, value: o.count, colour: GREY })), { labelWidth: 260, format: v => `${v}` })
    }

    if (r.callbacks.length) {
      pdf.heading("Callbacks to make", { size: 12 })
      pdf.table({
        columns: [
          { header: "Who", width: 1.6 },
          { header: "Role", width: 1 },
          { header: "When they said", width: 1.4 },
          { header: "Number", width: 1.1 },
          { header: "Campaign", width: 1.3 },
          { header: "Interest", width: 0.8 },
          { header: "Called", width: 0.9 },
        ],
        rows: r.callbacks.map(c => [
          c.contactName ?? c.leadName ?? "Unknown", c.contactRole ?? "", c.callbackWhen ?? "", c.bestNumber ?? c.phone ?? "",
          c.campaignName, c.interest, fmtStamp(c.at),
        ]),
        zebra: true,
      })
    }

    if (r.keyFacts.length) {
      pdf.heading("Things learned on calls", { size: 12 })
      for (const f of r.keyFacts) pdf.paragraph(`- ${f}`, { size: 8.5, gapAfter: 1 })
      pdf.space(6)
    }
  }

  /* ── Agents and reasons ───────────────────────────────────────────── */
  pdf.ensure(160)
  pdf.heading("By agent", { size: 12 })
  pdf.table({
    columns: [
      { header: "Agent", width: 2 },
      { header: "Calls", width: 0.8, align: "right" },
      { header: "Reached a person", width: 1.2, align: "right" },
      { header: "Minutes", width: 0.8, align: "right" },
      { header: "Charged", width: 0.9, align: "right" },
    ],
    rows: r.agents.map(ag => [ag.name, ag.calls, `${ag.humans} (${pct(ag.humans, ag.calls)})`, ag.minutes, usd(ag.costCents)]),
    zebra: true,
  })

  if (r.endedReasons.length) {
    pdf.heading("Why calls ended", { size: 12 })
    pdf.bars(r.endedReasons.map(e => ({ label: e.label, value: e.calls, colour: [150, 140, 200] })), { labelWidth: 230, format: v => `${v}` })
  }

  /* ── Method ───────────────────────────────────────────────────────── */
  pdf.ensure(120)
  pdf.rule()
  pdf.heading("How these numbers are counted", { size: 10, colour: MUTED })
  pdf.paragraph(
    "Every call is classified at the moment it ends by what actually picked up: a person, an automated phone menu, a voicemail greeting, no answer, or a failure to connect. " +
    "The classification uses the agent's own post-call extraction when available and the transcript otherwise. \"Reached a person\" is that classification, not call length. " +
    "Decision-maker, interest, callback and objection figures come from the agent's post-call extraction and refer to the person who answered, never to the agent. " +
    "Charges are what Hi-Astrix billed the workspace for these calls; calls inside a plan's included minutes are billed at $0.00.",
    { size: 7.5, colour: MUTED }
  )

  return pdf.finish((p, no, count) => {
    p.text(`${r.tenantName} - activity report - ${fmtDay(r.from)} to ${fmtDay(r.to)}`, p.margin, p.height - 22, { size: 7, colour: GREY, maxWidth: p.contentWidth - 60 })
    p.text(`Page ${no} of ${count}`, p.width - p.margin, p.height - 22, { size: 7, colour: GREY, align: "right" })
  })
}
