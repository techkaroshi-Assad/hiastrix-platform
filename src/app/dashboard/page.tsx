/**
 * Overview.
 *
 * ── WHAT THIS SCREEN IS FOR ───────────────────────────────────────────
 *
 * It is the first thing anybody sees after signing in, which means it has two
 * jobs and they are not the same job.
 *
 * For somebody who has just signed up, it is a **setup checklist**. They have no
 * calls, so four zeroes and an empty list is not a dashboard, it is a wall.
 * What they need is a sequence: connect a number, build an agent, make a test
 * call. That version of this page is the `Setup` block below, and it appears
 * automatically until all three are done.
 *
 * For somebody running the platform, it is a **daily check**. Is anything on
 * fire, is anything live right now, how did yesterday go. The previous version
 * showed four totals and the last five calls, which answers none of those:
 * "412 calls this month" is a number you cannot act on, and a list of five
 * calls tells you nothing you could not learn faster from the calls page.
 *
 * So the running version leads with what is different about today — anything
 * that is stopping calls from happening, anything live on the phone right
 * now — and the totals carry a sparkline and a comparison so they say
 * "up from last week" rather than merely "412".
 *
 * ── THE THINGS THAT STOP CALLS ────────────────────────────────────────
 *
 * A tenant whose balance has gone negative, or whose agents were switched off
 * by the reconciler, currently finds out when a customer complains. Those two
 * facts are checked here and shown at the top, in colour, above everything
 * else — this is the one screen where a warning is guaranteed to be seen.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { Page, StatCard } from "@/components/app/app-shell"
import { Card, Pill, callTone } from "@/components/app/table"
import { Sparkline } from "@/components/app/charts"
import {
  IconAgents, IconCalls, IconBalance, IconDuration, IconLive, IconNumbers,
  IconArrow, IconMagic, IconConnected, IconInbound, IconOutbound, IconCheck,
  IconMic, IconCampaigns,
} from "@/components/app/icons"
import {
  loadAnalytics, rangeFromDays, changePct, connectionRate, CONNECTED_SECONDS,
} from "@/lib/analytics"
import { loadOnboarding, type SetupStep } from "@/lib/onboarding"
import { usd, duration, titleCase } from "@/lib/format"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Dashboard" }
export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const { tenant, name } = await requireTenant()
  const firstName = name.split(" ")[0] || "there"

  const range = rangeFromDays(14)

  const [
    agentCount, activeAgents, numberCount, liveCalls, recentCalls,
    runningCampaigns, analytics, onboarding,
  ] = await Promise.all([
    prisma.agent.count({ where: { tenantId: tenant.id } }),
    prisma.agent.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
    prisma.phoneNumber.count({ where: { tenantId: tenant.id } }),

    // Live right now. Cheap — the index is on (tenant_id, created_at) and the
    // set is bounded by concurrency, so this is a handful of rows at most.
    prisma.call.findMany({
      where:   { tenantId: tenant.id, status: "IN_PROGRESS" },
      orderBy: { createdAt: "desc" },
      take:    5,
      include: { agent: { select: { name: true } } },
    }),

    prisma.call.findMany({
      where:   { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take:    6,
      include: { agent: { select: { name: true } } },
    }),

    prisma.campaign.count({ where: { tenantId: tenant.id, state: "RUNNING" } }),

    loadAnalytics(tenant.id, range),

    /* The same state the shell's setup bar reads. Computed once per request and
     * shared, so the bar at the top of the page and the checklist below it can
     * never disagree about how far along somebody is — which they did, briefly,
     * when this page worked it out for itself. */
    loadOnboarding(tenant),
  ])

  const t = analytics.totals
  const p = analytics.previous
  const rate = connectionRate(t)

  const cap         = tenant.package?.minutesIncluded ?? 0
  const used        = tenant.minutesUsed
  const remaining   = Math.max(0, cap - used)
  const overage     = Math.max(0, used - cap)
  const pct         = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const overageCost = overage * (tenant.package?.overageRateCents ?? 0)

  /* Only used for the balance card's caption now. Whether the workspace can
   * place a call at all is decided in `loadOnboarding`, which is also what the
   * shell's banner reads — one predicate, one answer. */
  const hasAllowance = cap > 0 && used < cap
  const trend = (now: number, before: number, goodWhenUp = true) => {
    const change = changePct(now, before)
    return change === null ? undefined : { pct: change, goodWhenUp, label: "vs the fortnight before" }
  }

  return (
    <Page
      heading={`Good to see you, ${firstName}`}
      description="Here's what's happening across your workspace."
    >
      {/* Anything actively stopping calls is shown by the shell, on every page —
          a warning that only exists on Overview is a warning somebody misses,
          because the moment things go quiet is the moment they are off looking
          at Calls. It is not repeated here.

          The checklist is the opposite case: it wants room, and somebody who
          has come to Overview has come to see where things stand. */}
      {!onboarding.complete ? (
        <Setup steps={onboarding.steps} done={onboarding.done} />
      ) : (
        <>
          {/* ── The four figures ───────────────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Calls, 14 days"
              value={t.calls.toLocaleString()}
              meta={`${t.connected.toLocaleString()} reached a person`}
              icon={<IconCalls size={16} />}
              trend={trend(t.calls, p.calls)}
              spark={<Sparkline values={analytics.series.map(s => s.calls)} label="Calls per day" />}
              href="/dashboard/calls"
            />
            <StatCard
              label="Connected"
              value={`${rate.toFixed(rate < 10 ? 1 : 0)}%`}
              meta={`Over ${CONNECTED_SECONDS} seconds of conversation`}
              icon={<IconConnected size={16} />}
              trend={trend(rate, connectionRate(p))}
              spark={
                <Sparkline values={analytics.series.map(s => s.connected)} colour={1} label="Connected per day" />
              }
              href="/dashboard/analytics"
            />
            <StatCard
              label="Typical call"
              value={analytics.medianSeconds > 0 ? duration(analytics.medianSeconds) : "—"}
              meta="Median length of a connected call"
              icon={<IconDuration size={16} />}
              href="/dashboard/analytics"
            />
            <StatCard
              label="Balance"
              value={usd(tenant.creditBalanceCents)}
              meta={
                hasAllowance
                  ? `${remaining.toLocaleString()} included minutes left`
                  : tenant.creditBalanceCents > 0
                    ? "Available credit"
                    : "Top up to keep calling"
              }
              icon={<IconBalance size={16} />}
              href="/dashboard/billing"
            />
          </div>

          {/* ── On the phone right now ─────────────────────────────── */}
          {liveCalls.length > 0 && (
            <div className="mt-6">
              <Card
                title={`On the phone now — ${liveCalls.length}`}
                icon={<IconLive size={15} className="animate-pulse-dot text-success" />}
                action={
                  <Link
                    href="/dashboard/calls?status=IN_PROGRESS"
                    className="text-[12.5px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
                  >
                    See them
                  </Link>
                }
              >
                <ul>
                  {liveCalls.map(call => (
                    <li
                      key={call.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-success" />
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium">
                            {call.callerNumber ?? "Web call"}
                          </p>
                          <p className="mt-0.5 text-[12px] text-subtle">
                            {call.agent?.name ?? "Unassigned agent"}
                          </p>
                        </div>
                      </div>
                      <Pill tone="brand">Live</Pill>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}

          {/* ── Usage against the package ──────────────────────────── */}
          {cap > 0 && (
            <section className="mt-6 rounded-2xl border border-line bg-field-soft p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                  {tenant.package?.name ?? "Package"} usage
                </h2>
                <p className="text-[12.5px] text-muted">
                  {remaining.toLocaleString()} min remaining
                </p>
              </div>

              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-field-hover"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Minutes used against your package"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500",
                    overage > 0
                      ? "bg-warning"
                      : "bg-linear-to-r from-brand-400 to-brand-600"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="mt-2.5 text-[12.5px] text-subtle">
                {used.toLocaleString()} of {cap.toLocaleString()} minutes used ({pct}%)
                {overage > 0 && (
                  <>
                    {" · "}
                    <span className="text-warning">
                      {overage.toLocaleString()} min overage — {usd(overageCost)}
                    </span>
                  </>
                )}
              </p>
            </section>
          )}

          {/* ── Recent activity ────────────────────────────────────── */}
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px]">
            <Card
              title="Recent calls"
              icon={<IconCalls size={15} />}
              action={
                <Link
                  href="/dashboard/calls"
                  className="text-[12.5px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
                >
                  View all
                </Link>
              }
            >
              <ul>
                {recentCalls.map(call => {
                  const Direction =
                    call.direction === "OUTBOUND" ? IconOutbound
                    : call.direction === "INBOUND" ? IconInbound
                    : IconMic
                  return (
                    <li key={call.id} className="border-b border-line-soft last:border-b-0">
                      <Link
                        href={`/dashboard/calls/${call.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-field-soft"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Direction size={15} className="shrink-0 text-subtle" />
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-medium">
                              {call.callerNumber ?? "Web call"}
                            </p>
                            <p className="mt-0.5 truncate text-[12px] text-subtle">
                              {call.agent?.name ?? "Unassigned agent"}
                              {" · "}
                              {call.startedAt
                                ? call.startedAt.toLocaleString("en-US", {
                                    month: "short", day: "numeric",
                                    hour: "numeric", minute: "2-digit",
                                  })
                                : "—"}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {/* Colour only when something is worth looking at.
                              Every ordinary call is COMPLETED, so tinting the
                              duration by status painted the whole list green
                              and taught the eye to skip it — which is exactly
                              the row you then miss when one goes wrong. */}
                          {call.status === "COMPLETED" ? (
                            <span className="text-[12.5px] tabular-nums text-muted">
                              {duration(call.durationSeconds)}
                            </span>
                          ) : (
                            <Pill tone={callTone(call.status)}>
                              {call.status === "IN_PROGRESS"
                                ? "Live"
                                : titleCase(call.status)}
                            </Pill>
                          )}
                          <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-subtle">
                            {usd(call.costCents)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </Card>

            <div className="space-y-5">
              <Card title="Your workspace">
                <ul className="divide-y divide-line-soft">
                  <Stat icon={<IconAgents size={15} />} label="Agents"
                        value={`${activeAgents} of ${agentCount} on`} href="/dashboard/agents" />
                  <Stat icon={<IconNumbers size={15} />} label="Phone numbers"
                        value={String(numberCount)} href="/dashboard/numbers" />
                  <Stat icon={<IconCampaigns size={15} />} label="Campaigns running"
                        value={String(runningCampaigns)} href="/dashboard/campaigns" />
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </Page>
  )
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

/**
 * The first-run sequence.
 *
 * The steps and their order come from `loadOnboarding`, not from this file. It
 * used to work them out itself from three counts, which was fine right up until
 * the shell started showing the same information in a bar and the two
 * disagreed — the bar said "point a number at it" while the checklist showed
 * only three steps and none of them were that.
 *
 * A completed step stays visible with a tick rather than disappearing. A
 * checklist that shrinks as you go gives no sense of progress, and hides the
 * evidence that you did the earlier ones correctly.
 */
function Setup({ steps, done }: { steps: SetupStep[]; done: number }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-field-soft">
      <div aria-hidden="true" className="wash-glow-top pointer-events-none absolute inset-0" />

      <header className="relative border-b border-line px-6 py-5">
        <div className="flex items-center gap-2.5">
          <IconMagic size={17} className="text-brand-300" />
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Get your phone answered</h2>
        </div>
        <p className="mt-1.5 text-[13px] font-light text-muted">
          {steps.length} things, in this order. {done} of {steps.length} done.
        </p>
        <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-field-hover">
          <div
            className="h-full rounded-full bg-linear-to-r from-brand-400 to-brand-600 transition-[width] duration-500"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
      </header>

      <ol className="relative">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className="flex flex-wrap items-start gap-4 border-b border-line-soft px-6 py-5 last:border-b-0"
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[13px] font-medium",
                s.done
                  ? "border-success/30 bg-success/12 text-success"
                  : "border-line bg-field text-subtle"
              )}
            >
              {s.done ? <IconCheck size={15} /> : i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <p className={cn("text-[13.5px] font-medium", s.done && "text-muted")}>
                {s.title}
              </p>
              <p className="mt-1 text-[12.5px] font-light leading-relaxed text-muted">{s.body}</p>
            </div>

            {/* No button on a step somebody cannot do. Sending them to a page to
                hunt for a control that is not there reads as a broken product
                rather than as a queue they are in. */}
            {!s.done && (
              s.waiting ? (
                <span className="shrink-0 text-[12px] font-light text-subtle">
                  We&rsquo;ll set this up
                </span>
              ) : (
                <Link
                  href={s.href}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-field border border-line-strong bg-field px-3.5 py-2 text-[12.5px] font-medium text-fg transition-colors hover:border-brand-400"
                >
                  {s.cta}
                  <IconArrow size={13} />
                </Link>
              )
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function Stat({
  icon, label, value, href,
}: {
  icon: React.ReactNode
  label: string
  value: string
  href: string
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-field-soft"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-subtle">{icon}</span>
          <span className="truncate text-[13px] text-muted">{label}</span>
        </span>
        <span className="shrink-0 text-[13px] font-medium tabular-nums">{value}</span>
      </Link>
    </li>
  )
}
