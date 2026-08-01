/**
 * Analytics.
 *
 * ── WHAT CHANGED ──────────────────────────────────────────────────────
 *
 * This page used to answer one question — how many calls — four different ways.
 * Volume, minutes, average duration and spend are all the same fact wearing
 * different hats, and it is the fact a tenant already knows, because they can
 * see their bill.
 *
 * The questions it answers now are the ones that change what somebody does:
 *
 *   **Are the calls connecting?** With the denominator visible, because 68%
 *   of nine calls and 68% of nine hundred are different facts.
 *
 *   **What does a conversation cost?** Spend over *connected* calls, not over
 *   every dial. The second number is the flattering one.
 *
 *   **How long is a real conversation?** Median and 90th percentile over
 *   connected calls. The mean is still shown, but it is dragged toward zero by
 *   every four-second no-answer, so on its own it says a good agent is bad.
 *
 *   **When does the phone actually ring?** An hour-of-week grid, in the
 *   tenant's own timezone. This is the chart most likely to make somebody
 *   change something.
 *
 * Every headline figure carries the same measurement over the immediately
 * preceding window of equal length, so a number reads as better or worse rather
 * than merely large.
 *
 * ── ON THE TIMEZONE ───────────────────────────────────────────────────
 *
 * Taken from the tenant's campaigns rather than from a setting, because there
 * is no tenant-level timezone field and inventing one would mean a migration
 * and a form nobody fills in. The campaign a tenant configured is the best
 * available evidence of what hours they think in. No campaigns means UTC, and
 * the page says so rather than quietly being five hours out.
 */

import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { Page, StatCard, EmptyState } from "@/components/app/app-shell"
import { Card, Table, TH, TD, EmptyRow } from "@/components/app/table"
import {
  ColumnChart, AreaChart, HBarList, Donut, HeatGrid, Meter, Sparkline,
} from "@/components/app/charts"
import {
  IconCalls, IconConnected, IconCost, IconDuration, IconHeat, IconAgents,
  IconTrend, IconGauge, IconRate,
} from "@/components/app/icons"
import {
  loadAnalytics, rangeFromDays, readableReason, outcomeMix,
  changePct, connectionRate, costPerConnect, avgHandleSeconds,
} from "@/lib/analytics"
import { usd, duration, titleCase } from "@/lib/format"
import { RangePicker } from "./range"

export const metadata: Metadata = { title: "Analytics" }
export const dynamic = "force-dynamic"

type Search = Promise<{ days?: string; metric?: string }>

const ALLOWED_DAYS = [7, 30, 90]

export default async function AnalyticsPage({ searchParams }: { searchParams: Search }) {
  const { tenant } = await requireTenant()
  const sp = await searchParams

  const requested = Number(sp.days ?? "30")
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30
  const metric =
    sp.metric === "minutes" || sp.metric === "cost" || sp.metric === "connected"
      ? sp.metric
      : "calls"

  /* The tenant's working timezone, as evidenced by whatever they set on a
   * campaign. See the note at the top of the file. */
  const zoneRow = await prisma.campaign.findFirst({
    where:   { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    select:  { timezone: true },
  })
  const zone = zoneRow?.timezone ?? "UTC"

  const range = rangeFromDays(days)
  const a = await loadAnalytics(tenant.id, range, zone)

  const t = a.totals
  const p = a.previous

  const rate     = connectionRate(t)
  const prevRate = connectionRate(p)
  const perConnect     = costPerConnect(t)
  const prevPerConnect = costPerConnect(p)
  const aht     = avgHandleSeconds(t)
  const prevAht = avgHandleSeconds(p)

  const seriesFor = {
    calls: {
      points: a.series.map(s => ({ day: s.day, value: s.calls })),
      format: (v: number) => `${v} call${v === 1 ? "" : "s"}`,
      label:  "Calls per day",
    },
    connected: {
      points: a.series.map(s => ({ day: s.day, value: s.connected })),
      format: (v: number) => `${v} connected`,
      label:  "Connected calls per day",
    },
    minutes: {
      points: a.series.map(s => ({ day: s.day, value: s.minutes })),
      format: (v: number) => `${v} min`,
      label:  "Minutes per day",
    },
    cost: {
      points: a.series.map(s => ({ day: s.day, value: s.costCents })),
      format: (v: number) => usd(v),
      label:  "Charged per day",
    },
  }[metric]

  const successRate = a.evaluated > 0 ? Math.round((a.succeeded / a.evaluated) * 100) : null

  /** A trend chip only when there is a previous period worth comparing to. */
  const trend = (now: number, before: number, goodWhenUp = true) => {
    const pct = changePct(now, before)
    return pct === null
      ? undefined
      : { pct, goodWhenUp, label: `vs the previous ${days} days` }
  }

  return (
    <Page
      heading="Analytics"
      description={`The last ${days} days across your agents.`}
    >
      <div className="mb-5">
        <RangePicker />
      </div>

      {t.calls === 0 ? (
        <EmptyState
          icon={<IconCalls />}
          title="Nothing to measure yet"
          body="Once your agents start taking calls, this page fills in — how many connect, what a conversation costs, when the phone actually rings, and which agent is doing the work."
        />
      ) : (
        <>
          {/* ── The four that matter ────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Calls"
              value={t.calls.toLocaleString()}
              meta={`Over ${days} days`}
              icon={<IconCalls size={16} />}
              trend={trend(t.calls, p.calls)}
              spark={<Sparkline values={a.series.map(s => s.calls)} label="Calls per day" />}
            />
            <StatCard
              label="Connected"
              value={`${rate.toFixed(rate < 10 ? 1 : 0)}%`}
              meta={`${t.connected.toLocaleString()} of ${t.calls.toLocaleString()} reached a person`}
              icon={<IconConnected size={16} />}
              trend={trend(rate, prevRate)}
              spark={
                <Sparkline values={a.series.map(s => s.connected)} colour={1} label="Connected per day" />
              }
            />
            <StatCard
              label="Cost per connect"
              value={t.connected > 0 ? usd(Math.round(perConnect)) : "—"}
              // Not "spend". Inside an allowance this is legitimately zero, and
              // a tenant seeing "$0.00" after 200 calls assumes it is broken.
              meta={
                t.costCents === 0
                  ? "Everything so far is inside your allowance"
                  : `${usd(t.costCents)} charged in total`
              }
              icon={<IconCost size={16} />}
              trend={trend(perConnect, prevPerConnect, false)}
            />
            <StatCard
              label="Typical call"
              value={a.medianSeconds > 0 ? duration(a.medianSeconds) : "—"}
              meta={
                a.p90Seconds > 0
                  ? `Median. Nine in ten finish inside ${duration(a.p90Seconds)}`
                  : "Median length of a connected call"
              }
              icon={<IconDuration size={16} />}
              trend={trend(aht, prevAht)}
            />
          </div>

          {/* ── The series ──────────────────────────────────────────── */}
          <div className="mt-5">
            <Card title={seriesFor.label} icon={<IconTrend size={15} />}>
              {/* Bars for counts, a line for money. Bars invite comparing one
                  day with another, which is the right instinct for volume; a
                  line invites reading the slope, which is the right instinct
                  for cost. */}
              {metric === "cost" ? (
                <AreaChart
                  points={seriesFor.points}
                  label={seriesFor.label}
                  format={seriesFor.format}
                  colour={3}
                />
              ) : (
                <ColumnChart
                  points={seriesFor.points}
                  label={seriesFor.label}
                  format={seriesFor.format}
                  colour={metric === "connected" ? 1 : 0}
                />
              )}
            </Card>
          </div>

          {/* ── When the phone rings ────────────────────────────────── */}
          <div className="mt-5">
            <Card
              title="When the phone rings"
              icon={<IconHeat size={15} />}
              note={
                zoneRow
                  ? `Times shown in ${zone.replace(/_/g, " ")}`
                  : "Times shown in UTC — set a timezone on a campaign to see your own hours"
              }
            >
              <HeatGrid
                cells={a.hourGrid}
                label="Calls by hour and weekday"
                format={v => `${v} call${v === 1 ? "" : "s"}`}
              />
            </Card>
          </div>

          {/* ── Outcomes ────────────────────────────────────────────── */}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card title="What happened to the calls" icon={<IconGauge size={15} />}>
              <Donut
                label="Call outcomes"
                rows={outcomeMix(a)}
                centreValue={t.calls.toLocaleString()}
                centreLabel="calls"
              />
            </Card>

            <Card title="Why calls ended" icon={<IconRate size={15} />}>
              <HBarList
                label="Reasons calls ended"
                colour={1}
                rows={a.byEndedReason.map(r => ({
                  label: readableReason(r.key),
                  value: r.calls,
                }))}
              />
            </Card>
          </div>

          {/* ── Agents ──────────────────────────────────────────────── */}
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
            <Card title="By agent" icon={<IconAgents size={15} />}>
              <Table>
                <thead>
                  <tr>
                    <TH>Agent</TH>
                    <TH align="right">Calls</TH>
                    <TH align="right">Connected</TH>
                    <TH align="right">Minutes</TH>
                    <TH align="right">Avg</TH>
                    <TH align="right">Charged</TH>
                  </tr>
                </thead>
                <tbody>
                  {a.byAgent.length === 0 ? (
                    <EmptyRow colSpan={6}>No agent activity in this range.</EmptyRow>
                  ) : (
                    a.byAgent.map(r => (
                      <tr key={r.agentId ?? "none"} className="transition-colors hover:bg-field-soft">
                        <TD className="font-medium">{r.name}</TD>
                        <TD align="right">{r.calls.toLocaleString()}</TD>
                        {/* The rate next to the count, because the count alone
                            makes the busiest agent look like the best one. */}
                        <TD align="right" muted>
                          {r.calls > 0
                            ? `${r.connected} · ${Math.round((r.connected / r.calls) * 100)}%`
                            : "—"}
                        </TD>
                        <TD align="right" muted>{r.minutes.toLocaleString()}</TD>
                        <TD align="right" muted>
                          {r.avgSeconds > 0 ? duration(r.avgSeconds) : "—"}
                        </TD>
                        <TD align="right">{usd(r.costCents)}</TD>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Card>

            <div className="space-y-5">
              <Card title="Direction">
                <HBarList
                  label="Calls by direction"
                  rainbow
                  rows={a.byDirection.map(d => ({
                    label: titleCase(d.key),
                    value: d.calls,
                  }))}
                />
              </Card>

              <Card title="Answer rate">
                <Meter
                  label="Reached a person"
                  value={t.connected}
                  of={t.calls}
                  colour={1}
                />
              </Card>

              <Card title="Outcome scoring">
                <div className="px-5 py-5">
                  {a.evaluated === 0 ? (
                    <p className="text-[13px] leading-relaxed text-subtle">
                      No calls were scored in this range. Turn on{" "}
                      <span className="text-muted">Score call success</span> under an
                      agent&rsquo;s post-call analysis to start measuring outcomes.
                    </p>
                  ) : (
                    <>
                      <p className="text-[26px] font-semibold tracking-[-0.03em]">
                        {successRate}%
                      </p>
                      {/* The denominator is scored calls, not all calls — scoring
                          is per agent and off by default. Saying "of 12 scored"
                          stops this reading as 12 out of 400. */}
                      <p className="mt-1 text-[12.5px] text-muted">
                        {a.succeeded} of {a.evaluated} scored call
                        {a.evaluated === 1 ? "" : "s"} met their goal
                      </p>
                      {a.scored > 0 && (
                        <p className="mt-3 text-xs leading-relaxed text-subtle">
                          {a.scored} call{a.scored === 1 ? " uses" : "s use"} a numeric
                          rubric rather than pass/fail, so {a.scored === 1 ? "it isn't" : "they aren't"} counted here.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
