/**
 * What a campaign actually produced — SERVER ONLY.
 *
 * The campaign page counts leads by state, which answers "how far through
 * the list are we". The analytics page counts calls by duration, which
 * answered "how many connected" until it turned out a phone menu counts.
 * Neither answers the question a sales lead asks the morning after: did we
 * get to anybody who matters, are any of them interested, and who do we
 * owe a call back.
 *
 * This module answers that, from two sources joined once:
 *
 *   calls.reached            — what picked up (lib/calls/reached.ts)
 *   calls.analysis           — the agent's own extraction, when the agent
 *                              uses the outbound preset
 *                              (lib/agents/extraction-presets.ts)
 *
 * The join between a campaign and its calls is `dial_attempts.provider_call_id
 * = calls.vapi_call_id` — the same convention-only link the campaign page
 * uses, because there is no foreign key between the dialer's bookkeeping
 * and the webhook's record.
 *
 * Values from the extraction are free text the model was asked to keep to
 * a list. They are normalised here, once, so a report and a page never
 * disagree about whether "Not Interested" and "not-interested" are the same
 * thing.
 */

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type { Reached } from "@/lib/calls/reached"

export type Interest = "interested" | "maybe" | "not-interested" | "unknown"
export type NextAction = "call-back" | "send-info" | "remove-from-list" | "done" | "unknown"
export type WhoAnswered = "decision-maker" | "gatekeeper" | "ivr" | "voicemail" | "nobody" | "unknown"

export function normInterest(v: unknown): Interest {
  const s = String(v ?? "").toLowerCase()
  if (/not[\s-]*interested|no interest|declin|refus/.test(s)) return "not-interested"
  if (/\binterested\b|\byes\b|keen|wants? (?:more|info|a call)/.test(s)) return "interested"
  if (/maybe|possibl|later|not (?:right )?now|perhaps|unsure/.test(s)) return "maybe"
  return "unknown"
}

export function normNextAction(v: unknown): NextAction {
  const s = String(v ?? "").toLowerCase()
  if (/remove|do not call|don't call|dnc|stop/.test(s)) return "remove-from-list"
  if (/call[\s-]*back|callback|try again|follow[\s-]*up/.test(s)) return "call-back"
  if (/send|email|info/.test(s)) return "send-info"
  if (/done|none|nothing|complete/.test(s)) return "done"
  return "unknown"
}

export function normWhoAnswered(v: unknown): WhoAnswered {
  const s = String(v ?? "").toLowerCase()
  if (/decision|owner|manager|doctor|billing/.test(s)) return "decision-maker"
  if (/gatekeeper|reception|front.?desk|staff|assistant/.test(s)) return "gatekeeper"
  if (/\bivr\b|menu|automated/.test(s)) return "ivr"
  if (/voice.?mail|machine/.test(s)) return "voicemail"
  if (/nobody|no.?one|no answer/.test(s)) return "nobody"
  return "unknown"
}

const truthy = (v: unknown) =>
  v === true || /^(true|yes|y|1)$/i.test(String(v ?? "").trim())

/* ── Shapes ────────────────────────────────────────────────────────────── */

export type CampaignOutcomes = {
  campaignId: string
  campaignName: string
  agentName: string
  /** Every call the campaign placed that produced a call record. */
  dials: number
  reached: Record<Reached, number>
  /** Calls where the agent reached a person AND the extraction ran. */
  extracted: number
  decisionMakers: number
  gatekeepers: number
  interest: Record<Interest, number>
  callbacksRequested: number
  nextAction: Record<NextAction, number>
  ivrSeen: number
  costCents: number
  minutes: number
  humanSeconds: number
}

export type CallOutcomeRow = {
  callId: string
  campaignId: string
  campaignName: string
  at: Date | null
  phone: string | null
  contactName: string | null
  leadName: string | null
  durationSeconds: number
  costCents: number
  reached: Reached | null
  ivrSeen: boolean
  endedReason: string | null
  summary: string | null
  whoAnswered: WhoAnswered
  reachedDecisionMaker: boolean
  contactRole: string | null
  interest: Interest
  callbackRequested: boolean
  callbackWhen: string | null
  bestNumber: string | null
  objection: string | null
  keyFacts: string[]
  nextAction: NextAction
  ivrOutcome: string | null
  transcript: string | null
}

const emptyReached = (): Record<Reached, number> =>
  ({ HUMAN: 0, IVR: 0, VOICEMAIL: 0, NO_ANSWER: 0, FAILED: 0 })
const emptyInterest = (): Record<Interest, number> =>
  ({ interested: 0, maybe: 0, "not-interested": 0, unknown: 0 })
const emptyNext = (): Record<NextAction, number> =>
  ({ "call-back": 0, "send-info": 0, "remove-from-list": 0, done: 0, unknown: 0 })

/* ── Per-call rows ─────────────────────────────────────────────────────── */

type RawRow = {
  call_id: string
  campaign_id: string
  campaign_name: string
  agent_name: string
  started_at: Date | null
  created_at: Date
  phone: string | null
  lead_name: string | null
  duration_seconds: number
  cost_cents: number
  reached: string | null
  ivr_seen: boolean
  ended_reason: string | null
  summary: string | null
  structured: unknown
  transcript: string | null
}

/**
 * Every campaign call in the window, one row each, with the extraction
 * unpacked. This is the single query behind the campaign page's outcome
 * cards, the analytics page's campaign table, and the downloadable report,
 * so the three cannot disagree.
 */
export async function loadCampaignCallRows(a: {
  tenantId: string
  campaignId?: string
  from: Date
  to: Date
  withTranscript?: boolean
}): Promise<CallOutcomeRow[]> {
  const campaignFilter = a.campaignId
    ? Prisma.sql`AND da.campaign_id = ${a.campaignId}::uuid`
    : Prisma.empty
  const transcriptCol = a.withTranscript
    ? Prisma.sql`c.transcript`
    : Prisma.sql`NULL::text`

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT DISTINCT ON (c.id)
           c.id                 AS call_id,
           cp.id                AS campaign_id,
           cp.name              AS campaign_name,
           ag.name              AS agent_name,
           c.started_at, c.created_at,
           COALESCE(cl.phone_e164, c.caller_number) AS phone,
           cl.contact_name      AS lead_name,
           c.duration_seconds, c.cost_cents,
           c.reached, c.ivr_seen, c.ended_reason, c.summary,
           c.analysis -> 'structuredData' AS structured,
           ${transcriptCol}     AS transcript
      FROM dial_attempts da
      JOIN calls c           ON c.vapi_call_id = da.provider_call_id
      JOIN campaigns cp      ON cp.id = da.campaign_id
      JOIN agents ag         ON ag.id = cp.agent_id
      LEFT JOIN campaign_leads cl ON cl.id = da.campaign_lead_id
     WHERE da.tenant_id = ${a.tenantId}::uuid
       AND c.created_at >= ${a.from} AND c.created_at <= ${a.to}
       ${campaignFilter}
     ORDER BY c.id, da.created_at DESC
  `

  return rows.map(r => {
    const sd = (r.structured && typeof r.structured === "object" && !Array.isArray(r.structured)
      ? r.structured
      : {}) as Record<string, unknown>
    const facts = Array.isArray(sd.keyFacts)
      ? sd.keyFacts.map(f => String(f)).filter(Boolean)
      : typeof sd.keyFacts === "string" && sd.keyFacts.trim() ? [sd.keyFacts] : []
    const str = (k: string) => {
      const v = sd[k]
      return typeof v === "string" && v.trim() ? v.trim() : null
    }
    return {
      callId: r.call_id,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      at: r.started_at ?? r.created_at,
      phone: r.phone,
      contactName: str("contactName"),
      leadName: r.lead_name,
      durationSeconds: r.duration_seconds,
      costCents: r.cost_cents,
      reached: (r.reached as Reached | null) ?? null,
      ivrSeen: r.ivr_seen,
      endedReason: r.ended_reason,
      summary: r.summary,
      whoAnswered: normWhoAnswered(sd.whoAnswered),
      reachedDecisionMaker: truthy(sd.reachedDecisionMaker),
      contactRole: str("contactRole"),
      interest: normInterest(sd.interestLevel),
      callbackRequested: truthy(sd.callbackRequested),
      callbackWhen: str("callbackWhen"),
      bestNumber: str("bestNumber"),
      objection: str("objection"),
      keyFacts: facts,
      nextAction: normNextAction(sd.nextAction),
      ivrOutcome: str("ivrOutcome"),
      transcript: r.transcript,
    }
  })
}

/* ── Rollups ───────────────────────────────────────────────────────────── */

export function rollup(rows: CallOutcomeRow[]): Map<string, CampaignOutcomes> {
  const out = new Map<string, CampaignOutcomes>()
  for (const r of rows) {
    let o = out.get(r.campaignId)
    if (!o) {
      o = {
        campaignId: r.campaignId, campaignName: r.campaignName, agentName: "",
        dials: 0, reached: emptyReached(), extracted: 0,
        decisionMakers: 0, gatekeepers: 0, interest: emptyInterest(),
        callbacksRequested: 0, nextAction: emptyNext(), ivrSeen: 0,
        costCents: 0, minutes: 0, humanSeconds: 0,
      }
      out.set(r.campaignId, o)
    }
    o.dials++
    if (r.reached) o.reached[r.reached]++
    if (r.ivrSeen) o.ivrSeen++
    o.costCents += r.costCents
    o.minutes += Math.ceil(r.durationSeconds / 60)
    if (r.reached === "HUMAN") {
      o.humanSeconds += r.durationSeconds
      const hasExtraction = r.whoAnswered !== "unknown" || r.interest !== "unknown"
      if (hasExtraction) o.extracted++
      if (r.reachedDecisionMaker || r.whoAnswered === "decision-maker") o.decisionMakers++
      else if (r.whoAnswered === "gatekeeper") o.gatekeepers++
      o.interest[r.interest]++
      if (r.callbackRequested) o.callbacksRequested++
      o.nextAction[r.nextAction]++
    }
  }
  return out
}

/** The whole tenant's campaign activity in one set of numbers. */
export function total(rows: CallOutcomeRow[]): CampaignOutcomes {
  const all = rollup(rows.map(r => ({ ...r, campaignId: "all", campaignName: "All campaigns" })))
  return all.get("all") ?? {
    campaignId: "all", campaignName: "All campaigns", agentName: "",
    dials: 0, reached: emptyReached(), extracted: 0,
    decisionMakers: 0, gatekeepers: 0, interest: emptyInterest(),
    callbacksRequested: 0, nextAction: emptyNext(), ivrSeen: 0,
    costCents: 0, minutes: 0, humanSeconds: 0,
  }
}

/** Calls that asked for a callback, most recent first — the follow-up list. */
export function callbacksDue(rows: CallOutcomeRow[]): CallOutcomeRow[] {
  return rows
    .filter(r => r.callbackRequested || r.nextAction === "call-back")
    .sort((x, y) => (y.at?.getTime() ?? 0) - (x.at?.getTime() ?? 0))
}
