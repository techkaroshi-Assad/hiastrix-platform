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
import { loadCampaignCallRows, loadRefusedAttempts, applyRefused, rollup, total, callbacksDue, type CampaignOutcomes, type CallOutcomeRow } from "@/lib/campaigns/insights"
import { REACHED_LABEL, type Reached } from "@/lib/calls/reached"
import { friendlyEndedReason } from "@/lib/calls/reasons"
import { scrubVendors } from "@/lib/vendor-safe"
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
  /**
   * Money, reconciled against the plan rather than summed off the calls.
   * A call's cost is only ever its overage portion, so "charged" without
   * "of which allowance" reads as a per-minute price that doesn't exist.
   */
  billing: {
    packageName: string | null
    packagePriceCents: number
    minutesIncluded: number
    overageRateCents: number
    assignedAt: Date | null
    /** Minutes billed for calls inside the report window. */
    minutesInPeriod: number
    /** The plan counter as it stands now (resets each period / on assignment). */
    minutesUsedOfAllowance: number
    /** Ledger movements dated inside the window. */
    overageCents: number
    overageMinutes: number
    payPerMinuteCents: number
    creditsAddedCents: number
    refundsCents: number
    balanceCents: number
  }
}

export async function loadActivityReport(a: {
  tenantId: string
  /**
   * Narrow the whole report to one campaign.
   *
   * The campaign page's "PDF report" button linked here without it, so
   * opening a campaign and pressing download produced a report covering
   * every campaign in the workspace — the right document, the wrong scope.
   * Both loaders below have always taken this filter; nothing passed it.
   */
  campaignId?: string
  from: Date
  to: Date
  timeZone?: string
}): Promise<ActivityReport> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: a.tenantId },
    select: {
      companyName: true, minutesUsed: true, creditBalanceCents: true, packageAssignedAt: true,
      package: { select: { name: true, priceCents: true, minutesIncluded: true, overageRateCents: true } },
    },
  })
  const zoneRow = a.timeZone
    ? null
    : await prisma.campaign.findFirst({ where: { tenantId: a.tenantId }, orderBy: { createdAt: "desc" }, select: { timezone: true } })
  const timeZone = safeZone(a.timeZone ?? zoneRow?.timezone ?? "UTC")

  const days = Math.max(1, Math.round((a.to.getTime() - a.from.getTime()) / 86_400_000))
  const range: Range = { from: a.from, to: a.to, days }

  const [an, rows, refused, reachedRows, ledger] = await Promise.all([
    loadAnalytics(a.tenantId, range, timeZone),
    loadCampaignCallRows({ tenantId: a.tenantId, campaignId: a.campaignId, from: a.from, to: a.to }),
    loadRefusedAttempts({ tenantId: a.tenantId, campaignId: a.campaignId, from: a.from, to: a.to }),
    prisma.$queryRaw<{ reached: string | null; n: bigint }[]>`
      SELECT reached, count(*)::bigint AS n FROM calls
       WHERE tenant_id = ${a.tenantId}::uuid AND created_at >= ${a.from} AND created_at <= ${a.to}
       GROUP BY reached
    `,
    prisma.$queryRaw<{ type: string; cents: bigint }[]>`
      SELECT type::text AS type, coalesce(sum(amount_cents), 0)::bigint AS cents FROM credit_ledger
       WHERE tenant_id = ${a.tenantId}::uuid AND created_at >= ${a.from} AND created_at <= ${a.to}
       GROUP BY type
    `,
  ])

  const ledgerBy = (t: string) => Number(ledger.find(l => l.type === t)?.cents ?? 0)
  const overageRate = tenant.package?.overageRateCents ?? 0
  const overageCents = -ledgerBy("OVERAGE_CHARGE")
  const billing: ActivityReport["billing"] = {
    packageName: tenant.package?.name ?? null,
    packagePriceCents: tenant.package?.priceCents ?? 0,
    minutesIncluded: tenant.package?.minutesIncluded ?? 0,
    overageRateCents: overageRate,
    assignedAt: tenant.packageAssignedAt,
    minutesInPeriod: an.totals.minutes,
    minutesUsedOfAllowance: tenant.minutesUsed,
    overageCents,
    overageMinutes: overageRate > 0 ? Math.round(overageCents / overageRate) : 0,
    payPerMinuteCents: -ledgerBy("CALL_DEDUCTION"),
    creditsAddedCents: ledgerBy("MANUAL_CREDIT") + ledgerBy("TOP_UP") + ledgerBy("PACKAGE_PURCHASE"),
    refundsCents: ledgerBy("REFUND"),
    balanceCents: tenant.creditBalanceCents,
  }

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

  const campaigns = [...applyRefused(rollup(rows), refused).values()].sort((x, y) => y.dials - x.dials)
  const campaignTotal = total(rows, refused)

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
    billing,
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

export type Audience = "client" | "internal"

/**
 * Campaign labels for a client-facing report.
 *
 * Internal campaign names ("New_Prompt run", "Data Pipeline Run 1-75") are
 * ours, not the client's, and they leak how the sausage was made. In
 * client mode campaigns are numbered in the order they were first dialled;
 * small runs that read as testing become "Optimisation step N", because
 * that is what they were.
 */
function campaignLabels(campaigns: CampaignOutcomes[], audience: Audience): Map<string, string> {
  const out = new Map<string, string>()
  if (audience === "internal") {
    for (const c of campaigns) out.set(c.campaignId, c.campaignName)
    return out
  }
  const isOptimisation = (c: CampaignOutcomes) =>
    /\b(test|run|prompt|pipeline|optim|trial|pilot|another)\b/i.test(c.campaignName) || c.dials + c.refusedBeforeDial <= 30
  // Order by size descending inside each group, so "Campaign 1" is the main one.
  const main = campaigns.filter(c => !isOptimisation(c)).sort((x, y) => (y.dials + y.refusedBeforeDial) - (x.dials + x.refusedBeforeDial))
  const opt = campaigns.filter(isOptimisation).sort((x, y) => (y.dials + y.refusedBeforeDial) - (x.dials + x.refusedBeforeDial))
  main.forEach((c, i) => out.set(c.campaignId, `Campaign ${i + 1}`))
  opt.forEach((c, i) => out.set(c.campaignId, `Optimisation step ${i + 1}`))
  return out
}

export function renderActivityPdf(r: ActivityReport, opts: { audience?: Audience } = {}): Buffer {
  const audience: Audience = opts.audience ?? "client"
  const internal = audience === "internal"
  const fmtDay = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: r.timeZone, year: "numeric", month: "long", day: "numeric" }).format(d)
  const fmtStamp = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("en-US", { timeZone: r.timeZone, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : ""

  const pdf = new Pdf({ title: `${r.tenantName} — activity report`, size: "A4", margin: 46 })
  const answered = r.reached.HUMAN + r.reached.IVR + r.reached.VOICEMAIL
  const ct = r.campaignTotal
  const label = campaignLabels(r.campaigns, audience)
  const nameOf = (id: string, fallback: string) => label.get(id) ?? fallback
  // Outcome detail (decision-makers, interest, callbacks) only exists when
  // the agent recorded it. When it didn't, the client version leaves it
  // out rather than printing a column of zeros with an excuse.
  const hasOutcomes = ct.extracted > 0

  /* ── Cover block ──────────────────────────────────────────────────── */
  pdf.rect(pdf.margin, pdf.margin, pdf.contentWidth, 96, { fill: [40, 32, 90] })
  pdf.text("HI-ASTRIX", pdf.margin + 18, pdf.margin + 24, { size: 8, font: "bold", colour: [200, 190, 255] })
  pdf.text(`${r.tenantName}`, pdf.margin + 18, pdf.margin + 52, { size: 22, font: "bold", colour: [255, 255, 255], maxWidth: pdf.contentWidth - 36 })
  pdf.text(internal ? "Activity report (internal)" : "Activity report", pdf.margin + 18, pdf.margin + 72, { size: 12, colour: [225, 220, 255] })
  pdf.text(`${fmtDay(r.from)} to ${fmtDay(r.to)}`, pdf.width - pdf.margin - 18, pdf.margin + 52, { size: 10, colour: [225, 220, 255], align: "right" })
  pdf.text(`Generated ${fmtStamp(r.generatedAt)} (${r.timeZone.replace(/_/g, " ")})`, pdf.width - pdf.margin - 18, pdf.margin + 72, { size: 8, colour: [200, 190, 255], align: "right" })
  pdf.y = pdf.margin + 96 + 18

  /* ── Headline ─────────────────────────────────────────────────────── */
  pdf.heading("At a glance")
  pdf.kpis([
    { label: "Calls", value: r.totals.calls.toLocaleString(), sub: `${r.byDirection.map(d => `${d.calls} ${d.key.toLowerCase()}`).join(" - ")}` },
    { label: "Reached a person", value: pct(r.totals.humans, r.totals.calls), sub: `${r.totals.humans.toLocaleString()} calls a person answered` },
    { label: "Minutes this period", value: r.totals.minutes.toLocaleString(), sub: r.totals.medianHumanSeconds ? `typical conversation ${mmss(r.totals.medianHumanSeconds)}` : undefined },
    ct.dials > 0
      ? { label: "People reached", value: ct.peopleReached.toLocaleString(), sub: `across ${r.campaigns.length} campaign${r.campaigns.length === 1 ? "" : "s"}` }
      : { label: "Conversations", value: r.totals.humans.toLocaleString() },
  ])

  if (ct.dials > 0 && hasOutcomes) {
    pdf.kpis([
      { label: "Decision-makers", value: ct.decisionMakers.toLocaleString(), sub: ct.reached.HUMAN ? `${pct(ct.decisionMakers, ct.reached.HUMAN)} of people reached` : undefined },
      { label: "Interested", value: (ct.interest.interested + ct.interest.maybe).toLocaleString(), sub: `${ct.interest.interested} yes - ${ct.interest.maybe} maybe - ${ct.interest["not-interested"]} no` },
      { label: "Callbacks owed", value: ct.callbacksRequested.toLocaleString() },
      { label: "Asked to be removed", value: ct.nextAction["remove-from-list"].toLocaleString() },
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
  if (ct.refusedBeforeDial > 0) {
    pdf.paragraph(
      internal
        ? `${ct.refusedBeforeDial} further attempt${ct.refusedBeforeDial === 1 ? "" : "s"} never became a call: the calling provider refused to start ${ct.refusedBeforeDial === 1 ? "it" : "them"}` +
          (ct.refusedReason ? ` ${scrubVendors(ct.refusedReason)}` : ".") + " Those leads were returned to the queue."
        : `A further ${ct.refusedBeforeDial} call attempt${ct.refusedBeforeDial === 1 ? "" : "s"} could not be placed in this period and ${ct.refusedBeforeDial === 1 ? "has" : "have"} been rescheduled.`,
      { size: 8.5, colour: MUTED }
    )
  }
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
    if (internal && r.extractedShare.humans > 0 && r.extractedShare.extracted === 0) {
      pdf.paragraph(
        "Interest, decision-maker and callback figures are absent because the campaign agent was not set up to record them during this period. " +
        "Switch on the \"Outbound cold call\" extraction preset on the agent and these fill in for every call from then on.",
        { size: 8.5, colour: AMBER }
      )
    }
    const cols: { header: string; width: number; align?: "left" | "right" }[] = [
      { header: "Campaign", width: 1.5 },
      { header: "Calls", width: 0.6, align: "right" },
      ...(internal ? [{ header: "Refused", width: 0.78, align: "right" as const }] : []),
      { header: "People", width: 0.7, align: "right" },
      { header: "Reached", width: 0.8, align: "right" },
      { header: "Menu only", width: 0.85, align: "right" },
      { header: "Voicemail", width: 0.9, align: "right" },
      ...(hasOutcomes
        ? [
            { header: "Decision-makers", width: 1.4, align: "right" as const },
            { header: "Interested", width: 0.9, align: "right" as const },
            { header: "Callbacks", width: 0.85, align: "right" as const },
          ]
        : []),
      { header: "Minutes", width: 0.75, align: "right" },
    ]
    const rowFor = (c: CampaignOutcomes, name: string) => [
      name, c.dials,
      ...(internal ? [c.refusedBeforeDial || ""] : []),
      c.peopleReached, pct(c.reached.HUMAN, c.dials), c.reached.IVR, c.reached.VOICEMAIL,
      ...(hasOutcomes ? [c.decisionMakers, c.interest.interested + c.interest.maybe, c.callbacksRequested] : []),
      c.minutes,
    ]
    const ordered = [...r.campaigns].sort((x, y) => nameOf(x.campaignId, x.campaignName).localeCompare(nameOf(y.campaignId, y.campaignName), undefined, { numeric: true }))
    pdf.table({
      columns: cols,
      size: 7.5,
      rows: [
        ...ordered.map(c => rowFor(c, nameOf(c.campaignId, c.campaignName))),
        ...(r.campaigns.length > 1 ? [rowFor(ct, "All campaigns")] : []),
      ],
      zebra: true,
      boldLast: r.campaigns.length > 1,
    })

    if (ct.reached.HUMAN > 0 && hasOutcomes) {
      pdf.heading("Where the conversations went", { size: 12 })
      pdf.bars([
        { label: "Reached the decision-maker", value: ct.decisionMakers, colour: GREEN },
        { label: "Stopped at reception", value: ct.gatekeepers, colour: AMBER },
        { label: "Interested", value: ct.interest.interested, colour: GREEN },
        { label: "Maybe / later", value: ct.interest.maybe, colour: [190, 160, 60] },
        { label: "Not interested", value: ct.interest["not-interested"], colour: GREY },
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
          nameOf(c.campaignId, c.campaignName), c.interest, fmtStamp(c.at),
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

  /* ── Agents ───────────────────────────────────────────────────────── */
  pdf.ensure(120)
  pdf.heading("By agent", { size: 12 })
  pdf.table({
    columns: [
      { header: "Agent", width: 2 },
      { header: "Calls", width: 0.8, align: "right" },
      { header: "Reached a person", width: 1.2, align: "right" },
      { header: "Minutes", width: 0.8, align: "right" },
    ],
    rows: r.agents.map(ag => [ag.name, ag.calls, `${ag.humans} (${pct(ag.humans, ag.calls)})`, ag.minutes]),
    zebra: true,
  })

  /* ── Internal only: end reasons and billing ───────────────────────── */
  if (internal) {
    if (r.endedReasons.length) {
      pdf.heading("Why calls ended", { size: 12 })
      pdf.bars(r.endedReasons.map(e => ({ label: e.label, value: e.calls, colour: [150, 140, 200] })), { labelWidth: 230, format: v => `${v}` })
    }
    const b = r.billing
    pdf.ensure(170)
    pdf.heading("Minutes and billing", { size: 12 })
    if (b.packageName) {
      const used = b.minutesUsedOfAllowance
      const left = Math.max(0, b.minutesIncluded - used)
      const over = Math.max(0, used - b.minutesIncluded)
      pdf.kpis([
        { label: "Plan", value: b.packageName, sub: `${b.minutesIncluded.toLocaleString()} min included - ${usd(b.packagePriceCents)}${b.assignedAt ? ` - since ${fmtDay(b.assignedAt)}` : ""}` },
        { label: "Minutes this period", value: b.minutesInPeriod.toLocaleString(), sub: "billed per started minute" },
        { label: "Allowance used", value: `${Math.min(used, b.minutesIncluded).toLocaleString()} / ${b.minutesIncluded.toLocaleString()}`, sub: over ? `${over} min over the allowance` : `${left} min left` },
        { label: "Overage this period", value: usd(b.overageCents), sub: b.overageCents ? `${b.overageMinutes} min x ${usd(b.overageRateCents)}/min` : `none - ${usd(b.overageRateCents)}/min past the allowance` },
      ])
      pdf.paragraph(
        `Minutes inside the plan cost nothing beyond the plan itself. Only minutes past ${b.minutesIncluded.toLocaleString()} are charged, at ${usd(b.overageRateCents)} per minute, from the credit balance. ` +
        (b.payPerMinuteCents ? `${usd(b.payPerMinuteCents)} of this period's calls were charged per minute before the plan was assigned. ` : "") +
        (b.refundsCents ? `${usd(b.refundsCents)} was refunded to the balance in this period. ` : "") +
        (b.creditsAddedCents ? `${usd(b.creditsAddedCents)} of credit was added. ` : "") +
        `Credit balance now: ${usd(b.balanceCents)}.`,
        { size: 8.5, colour: MUTED }
      )
    } else {
      pdf.kpis([
        { label: "Plan", value: "Pay as you go", sub: `${usd(b.overageRateCents)}/min from the credit balance` },
        { label: "Minutes this period", value: b.minutesInPeriod.toLocaleString(), sub: "billed per started minute" },
        { label: "Charged this period", value: usd(b.payPerMinuteCents) },
        { label: "Credit balance", value: usd(b.balanceCents), sub: b.creditsAddedCents ? `${usd(b.creditsAddedCents)} added in period` : undefined },
      ])
    }
  }

  /* ── Method ───────────────────────────────────────────────────────── */
  pdf.ensure(100)
  pdf.rule()
  pdf.heading("How these numbers are counted", { size: 10, colour: MUTED })
  pdf.paragraph(
    "Every call is classified when it ends by what actually picked up: a person, an automated phone menu, a voicemail greeting, no answer, or a call that could not connect. " +
    "\"Reached a person\" is that classification, not call length. " +
    (hasOutcomes ? "Decision-maker, interest, callback and objection figures are taken from each conversation and refer to the person who answered. " : "") +
    "Minutes are counted per started minute of call time.",
    { size: 7.5, colour: MUTED }
  )

  return pdf.finish((p, no, count) => {
    p.text(`${r.tenantName} - activity report - ${fmtDay(r.from)} to ${fmtDay(r.to)}`, p.margin, p.height - 22, { size: 7, colour: GREY, maxWidth: p.contentWidth - 60 })
    p.text(`Page ${no} of ${count}`, p.width - p.margin, p.height - 22, { size: 7, colour: GREY, align: "right" })
  })
}
