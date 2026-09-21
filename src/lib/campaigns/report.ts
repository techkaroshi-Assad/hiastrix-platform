/**
 * The downloadable report — SERVER ONLY.
 *
 * An Excel workbook, because that is what the person who asked for it will
 * open: a sales lead sorting callbacks by when they're due, not an engineer
 * parsing JSON. Three sheets, plus one more when transcripts are requested:
 *
 *   Summary     the campaign rollups — dials, reached, decision-makers,
 *               interest, callbacks, cost — one row per campaign and a
 *               total row
 *   Calls       one row per call with every extracted field
 *   Callbacks   the follow-up list, most recent first
 *   Transcripts (optional) one row per call, full text — long, so off by
 *               default
 *
 * Built from lib/campaigns/insights.ts rows, the same ones the campaign
 * page and Analytics render, so a figure in the file matches the figure on
 * the screen it was downloaded from. Written with lib/xlsx.ts.
 */

import { buildXlsx, type Sheet, type Cell } from "@/lib/xlsx"
import { REACHED_LABEL } from "@/lib/calls/reached"
import {
  rollup, total, callbacksDue, applyRefused,
  type CallOutcomeRow, type CampaignOutcomes, type RefusedRow,
} from "@/lib/campaigns/insights"

const money = (cents: number) => Math.round(cents) / 100

function summaryCells(o: CampaignOutcomes): Cell[] {
  const humans = o.reached.HUMAN
  return [
    o.campaignName,
    o.dials,
    o.refusedBeforeDial,
    humans,
    o.dials ? humans / o.dials : 0,
    o.reached.IVR,
    o.reached.VOICEMAIL,
    o.reached.NO_ANSWER,
    o.reached.FAILED,
    o.ivrSeen,
    o.decisionMakers,
    humans ? o.decisionMakers / humans : 0,
    o.gatekeepers,
    o.interest.interested,
    o.interest.maybe,
    o.interest["not-interested"],
    o.interest.unknown,
    o.callbacksRequested,
    o.nextAction["send-info"],
    o.nextAction["remove-from-list"],
    o.minutes,
    Math.round(o.humanSeconds / 60),
    money(o.costCents),
  ]
}

export function buildCampaignWorkbook(a: {
  rows: CallOutcomeRow[]
  /** Attempts the provider refused before dialing, so the summary can show them. */
  refused?: RefusedRow[]
  title: string
  from: Date
  to: Date
  timeZone: string
  withTranscripts: boolean
}): Buffer {
  const fmtDate = (d: Date | null) =>
    d ? new Intl.DateTimeFormat("en-US", {
      timeZone: a.timeZone, year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d) : ""

  /* ── Summary ─────────────────────────────────────────────────────── */
  const perCampaign = [...applyRefused(rollup(a.rows), a.refused ?? []).values()].sort((x, y) => y.dials - x.dials)
  const all = total(a.rows, a.refused ?? [])

  const summaryHeader: Cell[] = [
    "Campaign", "Calls", "Refused before dialing", "Reached a person", "Reached %", "Phone menu only", "Voicemail", "No answer", "Couldn't connect",
    "Menu heard", "Decision-makers", "Decision-maker %", "Stopped at reception",
    "Interested", "Maybe", "Not interested", "Interest not recorded",
    "Callbacks owed", "Send info", "Remove from list",
    "Minutes billed", "Minutes talking to people", "Overage charged (USD)",
  ]
  const summaryRows: Cell[][] = [
    [a.title],
    [`${fmtDate(a.from)} to ${fmtDate(a.to)} (${a.timeZone})`],
    [],
    ["Reached a person = someone actually spoke. A phone menu or voicemail is not counted, whatever the call length."],
    [],
    summaryHeader,
    ...perCampaign.map(summaryCells),
    ...(perCampaign.length > 1 ? [summaryCells(all)] : []),
  ]
  const summary: Sheet = {
    name: "Summary",
    rows: summaryRows,
    headerRow: 6,
    boldRows: [1, ...(perCampaign.length > 1 ? [summaryRows.length] : [])],
    widths: [34, ...Array(summaryHeader.length - 1).fill(16)],
    formats: Object.assign(Array(summaryHeader.length).fill(null), { 4: "percent", 11: "percent", 22: "usd" }),
    freezeHeader: false,
  }

  /* ── Calls ───────────────────────────────────────────────────────── */
  const callHeader: Cell[] = [
    "When", "Campaign", "Phone", "Name on list", "Who we spoke to", "Their role",
    "What picked up", "Menu heard", "Reached decision-maker", "Interest", "Callback requested", "Callback when",
    "Best number", "Objection", "Next action", "Menu outcome", "Key facts", "Summary",
    "Duration (s)", "Overage charged (USD)", "Ended because", "Call id",
  ]
  const sorted = [...a.rows].sort((x, y) => (y.at?.getTime() ?? 0) - (x.at?.getTime() ?? 0))
  const calls: Sheet = {
    name: "Calls",
    rows: [
      callHeader,
      ...sorted.map((r): Cell[] => [
        fmtDate(r.at), r.campaignName, r.phone ?? "", r.leadName ?? "", r.contactName ?? "", r.contactRole ?? "",
        r.reached ? REACHED_LABEL[r.reached] : "", r.ivrSeen ? "Yes" : "No",
        r.reachedDecisionMaker ? "Yes" : "No", r.interest, r.callbackRequested ? "Yes" : "No", r.callbackWhen ?? "",
        r.bestNumber ?? "", r.objection ?? "", r.nextAction, r.ivrOutcome ?? "", r.keyFacts.join("; "), r.summary ?? "",
        r.durationSeconds, money(r.costCents), r.endedReason ?? "", r.callId,
      ]),
    ],
    widths: [18, 26, 16, 22, 22, 16, 18, 10, 12, 14, 10, 24, 16, 30, 14, 14, 40, 50, 10, 12, 28, 38],
    formats: Object.assign(Array(callHeader.length).fill(null), { 18: "int", 19: "usd" }),
    freezeHeader: true,
    autoFilter: true,
  }

  /* ── Callbacks ───────────────────────────────────────────────────── */
  const callbacks: Sheet = {
    name: "Callbacks",
    rows: [
      ["When they said", "Who", "Role", "Reach them on", "Campaign", "Interest", "Objection / notes", "Called on", "Call id"],
      ...callbacksDue(a.rows).map((r): Cell[] => [
        r.callbackWhen ?? "", r.contactName ?? r.leadName ?? "", r.contactRole ?? "",
        r.bestNumber ?? r.phone ?? "", r.campaignName, r.interest,
        [r.objection, ...r.keyFacts].filter(Boolean).join("; "), fmtDate(r.at), r.callId,
      ]),
    ],
    widths: [26, 22, 16, 16, 26, 14, 50, 18, 38],
    freezeHeader: true,
    autoFilter: true,
  }

  const sheets: Sheet[] = [summary, calls, callbacks]

  /* ── Transcripts (optional) ──────────────────────────────────────── */
  if (a.withTranscripts) {
    sheets.push({
      name: "Transcripts",
      rows: [
        ["When", "Campaign", "Phone", "Who we spoke to", "Transcript", "Call id"],
        ...sorted.map((r): Cell[] => [
          fmtDate(r.at), r.campaignName, r.phone ?? "", r.contactName ?? "", r.transcript ?? "", r.callId,
        ]),
      ],
      widths: [18, 26, 16, 22, 120, 38],
      wrap: [4],
      freezeHeader: true,
    })
  }

  return buildXlsx(sheets, { creator: "Hi-Astrix" })
}
