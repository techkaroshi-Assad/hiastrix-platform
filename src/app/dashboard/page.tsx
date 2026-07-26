import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, StatCard, EmptyState } from "@/components/app/app-shell"
import { IconAgents } from "@/components/app/icons"

export const metadata: Metadata = { title: "Dashboard" }
export const dynamic = "force-dynamic"

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export default async function DashboardPage() {
  const { tenant, email, name } = await requireTenant()
  const firstName = name.split(" ")[0] || "there"

  const [activeAgents, recentCalls, monthCalls] = await Promise.all([
    prisma.agent.count({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
    prisma.call.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { agent: { select: { name: true } } },
    }),
    prisma.call.count({
      where: {
        tenantId: tenant.id,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
  ])

  const cap        = tenant.package?.minutesIncluded ?? 0
  const used       = tenant.minutesUsed
  const remaining  = Math.max(0, cap - used)
  const overage    = Math.max(0, used - cap)
  const pct        = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const overageCost = overage * (tenant.package?.overageRateCents ?? 0)

  return (
    <AppShell
      nav={tenantNav("overview")}
      heading={`Good to see you, ${firstName}`}
      description="Here's what's happening across your workspace."
      userEmail={email}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Calls this month"
          value={String(monthCalls)}
          meta={monthCalls === 0 ? "No calls placed yet" : "Across all agents"}
        />
        <StatCard
          label="Active agents"
          value={String(activeAgents)}
          meta={activeAgents === 0 ? "Create your first agent" : "Answering right now"}
        />
        <StatCard
          label="Minutes used"
          value={String(used)}
          meta={cap > 0 ? `of ${cap.toLocaleString()} included` : "No package assigned yet"}
        />
        <StatCard
          label="Balance"
          value={usd(tenant.creditBalanceCents)}
          meta={
            tenant.creditBalanceCents <= 0
              ? "Top up to start calling"
              : "Available credit"
          }
        />
      </div>

      {/* Usage against the package cap */}
      {cap > 0 && (
        <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
              {tenant.package?.name ?? "Package"} usage
            </h2>
            <p className="text-[12.5px] text-muted">
              {remaining.toLocaleString()} min remaining
            </p>
          </div>

          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.07]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Minutes used against your package"
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-brand-400 to-brand-600 transition-[width] duration-500"
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

      {/* Recent activity */}
      <section className="mt-6">
        {recentCalls.length === 0 ? (
          <EmptyState
            icon={<IconAgents />}
            title={activeAgents === 0 ? "No agents yet" : "No calls yet"}
            body={
              activeAgents === 0
                ? "An agent is the voice that answers or places your calls — its script, its personality, and the number it works from. Create one to get started."
                : "Once your agents start taking calls, the most recent ones will appear here."
            }
            action={
              <Link
                href="/dashboard/agents"
                className="inline-flex h-10 items-center rounded-field border border-white/[0.12] bg-white/[0.04] px-5 text-[13px] font-medium text-fg transition-colors hover:border-white/20 hover:bg-white/[0.07]"
              >
                {activeAgents === 0 ? "Create an agent" : "Go to agents"}
              </Link>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Recent calls</h2>
              <Link
                href="/dashboard/calls"
                className="text-[12.5px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
              >
                View all
              </Link>
            </div>
            <ul>
              {recentCalls.map(call => (
                <li
                  key={call.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.04] px-5 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium">
                      {call.agent?.name ?? "Unassigned agent"}
                    </p>
                    <p className="mt-0.5 text-[12px] text-subtle">
                      {call.callerNumber ?? "Web call"} ·{" "}
                      {call.direction.toLowerCase()} ·{" "}
                      {call.startedAt
                        ? call.startedAt.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-medium">
                      {Math.floor(call.durationSeconds / 60)}m{" "}
                      {call.durationSeconds % 60}s
                    </p>
                    <p className="mt-0.5 text-[12px] text-subtle">{usd(call.costCents)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </AppShell>
  )
}
