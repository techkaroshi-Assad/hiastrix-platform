/**
 * Tenant analytics.
 *
 * Queries our own `calls` table rather than the provider's analytics API: our
 * data is already tenant-scoped, co-located with the function, and indexed on
 * (tenant_id, created_at DESC). Going upstream would mean mapping assistant ids
 * back to tenants on every request, for worse latency and no extra information.
 *
 * ── WHAT THIS PAGE IS FOR ─────────────────────────────────────────────
 *
 * The previous version reported four totals and a bar chart of call volume.
 * Volume is the one number a tenant already knows, because they can see their
 * bill. What they cannot see, and what actually decides whether this platform
 * is worth paying for, is:
 *
 *   - **Are the calls connecting?** An outbound campaign at 12% connection is
 *     not an agent problem, it is a list problem or a caller-ID problem, and
 *     nothing in a volume chart distinguishes those from a quiet week.
 *   - **What is a connected call costing?** Cost per call divided by every
 *     attempt including the ones that rang out flatters the number badly.
 *   - **When does the phone actually ring?** A tenant whose calls all land
 *     between 8 and 10am needs a second number, not a better prompt.
 *   - **How long does a real conversation take?** The mean is dragged down by
 *     every four-second no-answer, so the median and the 90th percentile of
 *     *connected* calls are reported instead.
 *   - **Which agent is doing the work, and at what cost?**
 *   - **Is any of this moving?** Every headline figure carries the same
 *     measurement over the immediately preceding window of equal length, so a
 *     number can be read as better or worse rather than merely large.
 *
 * ── ON THE TIMEZONE ───────────────────────────────────────────────────
 *
 * The daily series and the hour-of-week grid are bucketed in the tenant's own
 * timezone, passed in and interpolated into `AT TIME ZONE`. Bucketing in UTC
 * smears a US business's morning across two calendar days and puts their 9am
 * spike in the 13:00 column, which makes the one genuinely actionable chart on
 * the page actively misleading. Postgres validates the zone name itself, and an
 * invalid one raises rather than silently falling back — so it is checked here
 * first, against the same list the campaign editor offers.
 *
 * SERVER ONLY.
 */

import { prisma } from "@/lib/prisma"

export type Range = { from: Date; to: Date; days: number }

export function rangeFromDays(days: number): Range {
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  const from = new Date(to)
  from.setDate(from.getDate() - (days - 1))
  from.setHours(0, 0, 0, 0)
  return { from, to, days }
}

/** The window of equal length immediately before this one. */
export function previousRange(range: Range): Range {
  const to = new Date(range.from)
  to.setMilliseconds(to.getMilliseconds() - 1)
  const from = new Date(to)
  from.setDate(from.getDate() - (range.days - 1))
  from.setHours(0, 0, 0, 0)
  return { from, to, days: range.days }
}

/**
 * A timezone Postgres will accept.
 *
 * The string reaches `AT TIME ZONE` as a parameter, so it cannot be an
 * injection — but an unknown zone raises `invalid_parameter_value` and takes
 * the whole page down with it, which is a worse outcome than being an hour out.
 * `Intl` already knows the valid set; anything it rejects becomes UTC.
 */
export function safeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC"
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return tz
  } catch {
    return "UTC"
  }
}

/** Postgres COUNT returns bigint, which is neither serialisable nor arithmetic. */
const n = (v: unknown) => Number(v ?? 0)

export type DayPoint = {
  day: string
  calls: number
  connected: number
  minutes: number
  costCents: number
}

export type AgentRow = {
  agentId: string | null
  name: string
  calls: number
  connected: number
  minutes: number
  costCents: number
  avgSeconds: number
}

/** The headline figures, and the same figures for the preceding window. */
export type Totals = {
  calls: number
  connected: number
  minutes: number
  costCents: number
  talkSeconds: number
}

export type Analytics = {
  totals: Totals
  previous: Totals

  /** Median and 90th percentile duration, over connected calls only. */
  medianSeconds: number
  p90Seconds: number

  series: DayPoint[]
  byStatus: { key: string; calls: number }[]
  byDirection: { key: string; calls: number }[]
  byEndedReason: { key: string; calls: number }[]
  byAgent: AgentRow[]

  /** 7 rows (Monday first) × 24 hours, in the tenant's timezone. */
  hourGrid: number[][]

  evaluated: number
  succeeded: number
  scored: number
}

/* ── Which calls count as "connected" ──────────────────────────────────── */

/**
 * A connected call is one where somebody actually spoke to the agent.
 *
 * Status alone will not do it. `COMPLETED` is written for a call that rang out
 * and hung up as well as for a four-minute conversation, so counting COMPLETED
 * as connected reports campaigns at 90% connection when the true figure is a
 * third of that. Ten seconds of audio is the line: shorter than that is a
 * voicemail beep, a wrong number, or somebody hanging up on the greeting.
 *
 * The same threshold is used by the dialer's own outcome classifier, and the
 * two must not drift — a campaign page and an analytics page disagreeing about
 * how many calls connected is a support ticket every time.
 */
export const CONNECTED_SECONDS = 10

type TotalsRow = { calls: bigint; connected: bigint; minutes: bigint; cost: bigint; talk: bigint }

const readTotals = (r: TotalsRow | undefined): Totals => ({
  calls:       n(r?.calls),
  connected:   n(r?.connected),
  minutes:     n(r?.minutes),
  costCents:   n(r?.cost),
  talkSeconds: n(r?.talk),
})

/* ── The query ─────────────────────────────────────────────────────────── */

export async function loadAnalytics(
  tenantId: string,
  range: Range,
  timeZone = "UTC"
): Promise<Analytics> {
  const zone = safeZone(timeZone)
  const prev = previousRange(range)
  const where = { tenantId, createdAt: { gte: range.from, lte: range.to } }

  const [
    totals, previous, percentiles,
    byStatus, byDirection, byEndedReason, byAgent,
    series, hours, evaluation,
  ] = await Promise.all([
    /* Written out twice rather than shared through a fragment helper.
     * `Prisma.raw` would work and would also be the one place in this file
     * where a string reaches the planner unparameterised, which is a door not
     * worth opening for five lines of arithmetic. */
    prisma.$queryRaw<TotalsRow[]>`
      SELECT count(*)::bigint                                        AS calls,
             count(*) FILTER (WHERE duration_seconds >= ${CONNECTED_SECONDS})::bigint AS connected,
             COALESCE(sum(minutes_billed), 0)::bigint                AS minutes,
             COALESCE(sum(cost_cents), 0)::bigint                    AS cost,
             COALESCE(sum(duration_seconds), 0)::bigint              AS talk
        FROM calls
       WHERE tenant_id = ${tenantId}::uuid
         AND created_at >= ${range.from} AND created_at <= ${range.to}
    `,

    prisma.$queryRaw<TotalsRow[]>`
      SELECT count(*)::bigint                                        AS calls,
             count(*) FILTER (WHERE duration_seconds >= ${CONNECTED_SECONDS})::bigint AS connected,
             COALESCE(sum(minutes_billed), 0)::bigint                AS minutes,
             COALESCE(sum(cost_cents), 0)::bigint                    AS cost,
             COALESCE(sum(duration_seconds), 0)::bigint              AS talk
        FROM calls
       WHERE tenant_id = ${tenantId}::uuid
         AND created_at >= ${prev.from} AND created_at <= ${prev.to}
    `,

    /* Median and p90 over connected calls only. The mean is reported too, but
     * on its own it is close to useless here: a list where half the numbers
     * ring out has a mean handle time of about twenty seconds and a median
     * conversation of two minutes, and only the second one is a fact about
     * how the agent is doing. */
    prisma.$queryRaw<Array<{ median: number | null; p90: number | null }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_seconds) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_seconds) AS p90
        FROM calls
       WHERE tenant_id = ${tenantId}::uuid
         AND created_at >= ${range.from} AND created_at <= ${range.to}
         AND duration_seconds >= ${CONNECTED_SECONDS}
    `,

    prisma.call.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.call.groupBy({ by: ["direction"], where, _count: { _all: true } }),

    // High cardinality upstream (~40 values), so it is capped after sorting.
    prisma.call.groupBy({
      by: ["endedReason"],
      where: { ...where, endedReason: { not: null } },
      _count: { _all: true },
    }),

    prisma.$queryRaw<Array<{
      agent_id: string | null
      calls: bigint; connected: bigint; minutes: bigint; cost: bigint; avg: number | null
    }>>`
      SELECT agent_id,
             count(*)::bigint                                            AS calls,
             count(*) FILTER (WHERE duration_seconds >= ${CONNECTED_SECONDS})::bigint AS connected,
             COALESCE(sum(minutes_billed), 0)::bigint                    AS minutes,
             COALESCE(sum(cost_cents), 0)::bigint                        AS cost,
             avg(duration_seconds) FILTER (WHERE duration_seconds >= ${CONNECTED_SECONDS}) AS avg
        FROM calls
       WHERE tenant_id = ${tenantId}::uuid
         AND created_at >= ${range.from} AND created_at <= ${range.to}
       GROUP BY agent_id
    `,

    // Not expressible via Prisma groupBy: created_at is a timestamp, so
    // grouping on it directly yields one bucket per microsecond.
    prisma.$queryRaw<Array<{
      day: string; calls: bigint; connected: bigint; minutes: bigint; cost: bigint
    }>>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${zone}), 'YYYY-MM-DD') AS day,
             count(*)::bigint                                        AS calls,
             count(*) FILTER (WHERE duration_seconds >= ${CONNECTED_SECONDS})::bigint AS connected,
             COALESCE(sum(minutes_billed), 0)::bigint                AS minutes,
             COALESCE(sum(cost_cents), 0)::bigint                    AS cost
        FROM calls
       WHERE tenant_id  = ${tenantId}::uuid
         AND created_at >= ${range.from}
         AND created_at <= ${range.to}
       GROUP BY 1
       ORDER BY 1
    `,

    /* isodow is 1..7 Monday-first, which is the order the grid renders in, so
     * no remapping is needed and there is no off-by-one to get wrong. */
    prisma.$queryRaw<Array<{ dow: number; hour: number; calls: bigint }>>`
      SELECT EXTRACT(isodow FROM created_at AT TIME ZONE ${zone})::int AS dow,
             EXTRACT(hour   FROM created_at AT TIME ZONE ${zone})::int AS hour,
             count(*)::bigint                                          AS calls
        FROM calls
       WHERE tenant_id  = ${tenantId}::uuid
         AND created_at >= ${range.from}
         AND created_at <= ${range.to}
       GROUP BY 1, 2
    `,

    // The provider's rubric vocabulary varies — booleans, "pass", and numeric
    // scores all appear. Normalise here and report the denominator honestly
    // rather than inventing a percentage.
    prisma.$queryRaw<Array<{ evaluated: bigint; succeeded: bigint; scored: bigint }>>`
      SELECT
        count(*) FILTER (
          WHERE analysis ? 'successEvaluation'
            AND analysis ->> 'successEvaluation' IS NOT NULL
        )::bigint AS evaluated,
        count(*) FILTER (
          WHERE lower(analysis ->> 'successEvaluation')
                IN ('true','pass','passed','success','yes')
        )::bigint AS succeeded,
        count(*) FILTER (
          WHERE analysis ->> 'successEvaluation' ~ '^[0-9]+(\\.[0-9]+)?$'
        )::bigint AS scored
        FROM calls
       WHERE tenant_id  = ${tenantId}::uuid
         AND created_at >= ${range.from}
         AND created_at <= ${range.to}
    `,
  ])

  /* Agent names: the raw group-by cannot join without a second index lookup per
   * row, so they are resolved in one query afterwards. */
  const ids = byAgent.map(r => r.agent_id).filter((v): v is string => Boolean(v))
  const agents = ids.length
    ? await prisma.agent.findMany({
        where:  { tenantId, id: { in: ids } },
        select: { id: true, name: true },
      })
    : []
  const nameOf = new Map(agents.map((a: { id: string; name: string }) => [a.id, a.name]))

  /* Zero-fill, so a quiet day is a gap in the chart rather than a day that
   * silently does not exist and shifts everything after it left. */
  const byDay = new Map(series.map(r => [r.day, r]))
  const filled: DayPoint[] = []
  for (let i = 0; i < range.days; i++) {
    const d = new Date(range.from)
    d.setDate(d.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const row = byDay.get(key)
    filled.push({
      day:       key,
      calls:     n(row?.calls),
      connected: n(row?.connected),
      minutes:   n(row?.minutes),
      costCents: n(row?.cost),
    })
  }

  const hourGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const h of hours) {
    const row = hourGrid[h.dow - 1]
    if (row && h.hour >= 0 && h.hour < 24) row[h.hour] = n(h.calls)
  }

  const evalRow = evaluation[0]
  const pct = percentiles[0]

  return {
    totals:   readTotals(totals[0]),
    previous: readTotals(previous[0]),

    medianSeconds: Math.round(pct?.median ?? 0),
    p90Seconds:    Math.round(pct?.p90 ?? 0),

    series: filled,

    byStatus: byStatus
      .map(r => ({ key: String(r.status), calls: r._count._all }))
      .sort((a, b) => b.calls - a.calls),

    byDirection: byDirection
      .map(r => ({ key: String(r.direction), calls: r._count._all }))
      .sort((a, b) => b.calls - a.calls),

    byEndedReason: byEndedReason
      .map(r => ({ key: String(r.endedReason), calls: r._count._all }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8),

    byAgent: byAgent
      .map(r => ({
        agentId:    r.agent_id,
        name:       r.agent_id ? nameOf.get(r.agent_id) ?? "Deleted agent" : "No agent",
        calls:      n(r.calls),
        connected:  n(r.connected),
        minutes:    n(r.minutes),
        costCents:  n(r.cost),
        avgSeconds: Math.round(r.avg ?? 0),
      }))
      .sort((a, b) => b.calls - a.calls),

    hourGrid,

    evaluated: n(evalRow?.evaluated),
    succeeded: n(evalRow?.succeeded),
    scored:    n(evalRow?.scored),
  }
}

/* ── Derived figures ───────────────────────────────────────────────────── */

/**
 * Percentage change, with the cases that break it handled explicitly.
 *
 * Going from nothing to something is not "+∞%" and it is not "+100%" either;
 * both are wrong in ways that make a dashboard untrustworthy. It returns null,
 * and the caller shows no chip at all.
 */
export function changePct(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null
  return ((now - before) / before) * 100
}

export const connectionRate = (t: Totals) =>
  t.calls > 0 ? (t.connected / t.calls) * 100 : 0

/**
 * What a conversation costs, rather than what a dial costs.
 *
 * Dividing spend by every attempt is the number that flatters; dividing by the
 * calls somebody actually answered is the number that decides whether a
 * campaign is worth running.
 */
export const costPerConnect = (t: Totals) =>
  t.connected > 0 ? t.costCents / t.connected : 0

/** Mean handle time over connected calls, in seconds. */
export const avgHandleSeconds = (t: Totals) =>
  t.connected > 0 ? Math.round(t.talkSeconds / t.connected) : 0

/* ── Naming ────────────────────────────────────────────────────────────── */

/** Turn a provider endedReason into something a human reads without a glossary. */
export function readableReason(reason: string) {
  const map: Record<string, string> = {
    "customer-ended-call":            "Caller hung up",
    "assistant-ended-call":           "Agent ended the call",
    "silence-timed-out":              "Silence — timed out",
    "customer-did-not-answer":        "No answer",
    "customer-busy":                  "Line busy",
    "assistant-said-end-call-phrase": "Agent said a sign-off phrase",
    "exceeded-max-duration":          "Hit the length limit",
    "voicemail":                      "Reached voicemail",
    "pipeline-error":                 "Technical fault",
  }
  if (map[reason]) return map[reason]
  const s = reason.replace(/[-_]/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The outcome mix, in the order a person reads it.
 *
 * Deliberately not the raw `status` enum. `COMPLETED` covers both a real
 * conversation and a call that rang out, so showing the enum as-is tells a
 * tenant their campaign completed 90% of its calls when almost none of them
 * were answered. This splits on the same ten-second line used everywhere else.
 */
export function outcomeMix(a: Analytics): { label: string; value: number }[] {
  const byKey = new Map(a.byStatus.map(r => [r.key, r.calls]))
  const total = a.totals.calls

  const noAnswer = byKey.get("NO_ANSWER") ?? 0
  const busy     = byKey.get("BUSY") ?? 0
  const failed   = byKey.get("FAILED") ?? 0
  const live     = byKey.get("IN_PROGRESS") ?? 0

  // Whatever is left after the connected ones and the explicit failures is a
  // call that completed without anybody really speaking.
  const short = Math.max(0, total - a.totals.connected - noAnswer - busy - failed - live)

  return [
    { label: "Connected",   value: a.totals.connected },
    { label: "Too short",   value: short },
    { label: "No answer",   value: noAnswer },
    { label: "Busy",        value: busy },
    { label: "Failed",      value: failed },
    { label: "In progress", value: live },
  ].filter(r => r.value > 0)
}
