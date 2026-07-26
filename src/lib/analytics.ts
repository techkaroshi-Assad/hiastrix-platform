/**
 * Tenant analytics.
 *
 * Queries our own `calls` table rather than the provider's analytics API: our
 * data is already tenant-scoped, co-located with the function, and indexed on
 * (tenant_id, created_at DESC). Going upstream would mean mapping assistant ids
 * back to tenants on every request, for worse latency and no extra information.
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

/** Postgres COUNT returns bigint, which is neither serialisable nor arithmetic. */
const n = (v: unknown) => Number(v ?? 0)

export type DayPoint = {
  day: string
  calls: number
  minutes: number
  costCents: number
}

export type AgentRow = {
  agentId: string | null
  name: string
  calls: number
  minutes: number
  costCents: number
  avgSeconds: number
}

export type Analytics = {
  totalCalls: number
  totalMinutes: number
  totalCostCents: number
  avgSeconds: number
  series: DayPoint[]
  byStatus: { key: string; calls: number }[]
  byDirection: { key: string; calls: number }[]
  byEndedReason: { key: string; calls: number }[]
  byAgent: AgentRow[]
  evaluated: number
  succeeded: number
  scored: number
}

export async function loadAnalytics(tenantId: string, range: Range): Promise<Analytics> {
  const where = { tenantId, createdAt: { gte: range.from, lte: range.to } }

  const [totals, byStatus, byDirection, byEndedReason, byAgent, series, evaluation] =
    await Promise.all([
      prisma.call.aggregate({
        where,
        _count: { _all: true },
        _sum:   { durationSeconds: true, minutesBilled: true, costCents: true },
        _avg:   { durationSeconds: true },
      }),

      prisma.call.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),

      prisma.call.groupBy({
        by: ["direction"],
        where,
        _count: { _all: true },
      }),

      // High cardinality upstream (~40 values), so cap it.
      prisma.call.groupBy({
        by: ["endedReason"],
        where: { ...where, endedReason: { not: null } },
        _count: { _all: true },
      }),

      prisma.call.groupBy({
        by: ["agentId"],
        where,
        _count: { _all: true },
        _sum:   { durationSeconds: true, minutesBilled: true, costCents: true },
        _avg:   { durationSeconds: true },
      }),

      // Not expressible via Prisma groupBy: created_at is a timestamp, so
      // grouping on it yields one bucket per microsecond.
      prisma.$queryRaw<
        Array<{ day: Date; calls: bigint; minutes: bigint; cost: bigint }>
      >`
        SELECT date_trunc('day', created_at)              AS day,
               count(*)::bigint                           AS calls,
               COALESCE(sum(minutes_billed), 0)::bigint   AS minutes,
               COALESCE(sum(cost_cents),     0)::bigint   AS cost
          FROM calls
         WHERE tenant_id  = ${tenantId}::uuid
           AND created_at >= ${range.from}
           AND created_at <= ${range.to}
         GROUP BY 1
         ORDER BY 1
      `,

      // The provider's rubric vocabulary varies — booleans, "pass", and numeric
      // scores all appear. Normalise here and report the denominator honestly
      // rather than inventing a percentage.
      prisma.$queryRaw<
        Array<{ evaluated: bigint; succeeded: bigint; scored: bigint }>
      >`
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

  // groupBy cannot join, so resolve names separately.
  const ids = byAgent.map(r => r.agentId).filter((v): v is string => Boolean(v))
  const agents = ids.length
    ? await prisma.agent.findMany({
        where:  { tenantId, id: { in: ids } },
        select: { id: true, name: true },
      })
    : []
  const nameOf = new Map(agents.map((a: { id: string; name: string }) => [a.id, a.name]))

  // Zero-fill so a quiet day is a gap in the chart, not a missing column.
  const byDay = new Map(
    series.map(r => [r.day.toISOString().slice(0, 10), r])
  )
  const filled: DayPoint[] = []
  for (let i = 0; i < range.days; i++) {
    const d = new Date(range.from)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    const row = byDay.get(key)
    filled.push({
      day: key,
      calls:     n(row?.calls),
      minutes:   n(row?.minutes),
      costCents: n(row?.cost),
    })
  }

  const evalRow = evaluation[0]

  return {
    totalCalls:     totals._count._all,
    totalMinutes:   n(totals._sum.minutesBilled),
    totalCostCents: n(totals._sum.costCents),
    avgSeconds:     Math.round(n(totals._avg.durationSeconds)),
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
        agentId:   r.agentId,
        name:      r.agentId ? nameOf.get(r.agentId) ?? "Deleted agent" : "No agent",
        calls:     r._count._all,
        minutes:   n(r._sum.minutesBilled),
        costCents: n(r._sum.costCents),
        avgSeconds: Math.round(n(r._avg.durationSeconds)),
      }))
      .sort((a, b) => b.calls - a.calls),

    evaluated: n(evalRow?.evaluated),
    succeeded: n(evalRow?.succeeded),
    scored:    n(evalRow?.scored),
  }
}

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
