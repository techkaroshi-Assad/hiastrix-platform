import type { Metadata } from "next"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, StatCard, EmptyState } from "@/components/app/app-shell"
import { Card, Table, TH, TD, EmptyRow } from "@/components/app/table"
import { ColumnChart, HBarList, StackedBar } from "@/components/app/charts"
import { IconCalls } from "@/components/app/icons"
import { loadAnalytics, rangeFromDays, readableReason } from "@/lib/analytics"
import { usd, duration, titleCase } from "@/lib/format"
import { RangePicker } from "./range"

export const metadata: Metadata = { title: "Analytics" }
export const dynamic = "force-dynamic"

type Search = Promise<{ days?: string; metric?: string }>

const ALLOWED_DAYS = [7, 30, 90]

export default async function AnalyticsPage({ searchParams }: { searchParams: Search }) {
  const { tenant, email } = await requireTenant()
  const sp = await searchParams

  const requested = Number(sp.days ?? "30")
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30
  const metric = sp.metric === "minutes" || sp.metric === "cost" ? sp.metric : "calls"

  const range = rangeFromDays(days)
  const a = await loadAnalytics(tenant.id, range)

  const seriesFor = {
    calls:   { points: a.series.map(p => ({ day: p.day, value: p.calls })),      format: (v: number) => `${v} call${v === 1 ? "" : "s"}`, label: "Calls per day" },
    minutes: { points: a.series.map(p => ({ day: p.day, value: p.minutes })),    format: (v: number) => `${v} min`,                       label: "Minutes per day" },
    cost:    { points: a.series.map(p => ({ day: p.day, value: p.costCents })),  format: (v: number) => usd(v),                            label: "Charged per day" },
  }[metric]

  const successRate =
    a.evaluated > 0 ? Math.round((a.succeeded / a.evaluated) * 100) : null

  return (
    <AppShell
      nav={tenantNav("analytics")}
      heading="Analytics"
      description={`The last ${days} days across your agents.`}
      userEmail={email}
    >
      <div className="mb-5">
        <RangePicker />
      </div>

      {a.totalCalls === 0 ? (
        <EmptyState
          icon={<IconCalls />}
          title="Nothing to measure yet"
          body="Once your agents start taking calls, this page fills in — volume over time, how calls end, which agent handles what, and what it costs."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Calls"
              value={a.totalCalls.toLocaleString()}
              meta={`Over ${days} days`}
            />
            <StatCard
              label="Minutes used"
              value={a.totalMinutes.toLocaleString()}
              meta="Billed, rounded up per call"
            />
            <StatCard
              label="Average duration"
              value={a.avgSeconds > 0 ? duration(a.avgSeconds) : "—"}
              meta="Across every call"
            />
            <StatCard
              label="Charged"
              value={usd(a.totalCostCents)}
              // Not "Spend" — inside an allowance this is legitimately zero, and
              // a tenant seeing "$0.00 spend" after 200 calls assumes it's broken.
              meta={
                a.totalCostCents === 0
                  ? "Everything so far is inside your allowance"
                  : "Beyond your included minutes"
              }
            />
          </div>

          <div className="mt-5">
            <Card title={seriesFor.label}>
              <ColumnChart
                points={seriesFor.points}
                label={seriesFor.label}
                format={seriesFor.format}
              />
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card title="How calls ended">
              <StackedBar
                label="Call outcomes"
                rows={a.byStatus.map(s => ({ label: titleCase(s.key), value: s.calls }))}
              />
            </Card>

            <Card title="Why calls ended">
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

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
            <Card title="By agent">
              <Table>
                <thead>
                  <tr>
                    <TH>Agent</TH>
                    <TH align="right">Calls</TH>
                    <TH align="right">Minutes</TH>
                    <TH align="right">Avg</TH>
                    <TH align="right">Charged</TH>
                  </tr>
                </thead>
                <tbody>
                  {a.byAgent.length === 0 ? (
                    <EmptyRow colSpan={5}>No agent activity in this range.</EmptyRow>
                  ) : (
                    a.byAgent.map(r => (
                      <tr key={r.agentId ?? "none"} className="transition-colors hover:bg-field-soft">
                        <TD className="font-medium">{r.name}</TD>
                        <TD align="right">{r.calls.toLocaleString()}</TD>
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
                  colour={2}
                  rows={a.byDirection.map(d => ({
                    label: titleCase(d.key),
                    value: d.calls,
                  }))}
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
    </AppShell>
  )
}
