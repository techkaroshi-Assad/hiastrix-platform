import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { adminNav } from "@/lib/nav-admin"
import { AppShell, StatCard } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow, callTone } from "@/components/app/table"
import { usd, duration, dateTime, dateOnly, titleCase } from "@/lib/format"
import { TenantControls } from "./tenant-controls"
import { AddAccountManager } from "./add-user"

export const metadata: Metadata = { title: "Tenant" }
export const dynamic = "force-dynamic"

/** Structural subset of TenantUser — the generated row satisfies this. */
type TenantMember = {
  id: string
  name: string
  email: string
  type: string
  createdAt: Date
}

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const admin = await requireAdmin()

  const [tenant, packages, recentCalls, ledger] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id },
      include: {
        package: true,
        users:   { orderBy: { createdAt: "asc" } },
        _count:  { select: { agents: true, calls: true, phoneNumbers: true } },
      },
    }),
    prisma.package.findMany({
      where:   { isActive: true },
      orderBy: { minutesIncluded: "asc" },
      select:  { id: true, name: true, minutesIncluded: true },
    }),
    prisma.call.findMany({
      where:   { tenantId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { agent: { select: { name: true } } },
    }),
    prisma.creditLedger.findMany({
      where:   { tenantId: id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ])

  if (!tenant) notFound()

  const cap     = tenant.package?.minutesIncluded ?? 0
  const overage = Math.max(0, tenant.minutesUsed - cap)
  const pct     = cap > 0 ? Math.min(100, Math.round((tenant.minutesUsed / cap) * 100)) : 0

  return (
    <AppShell
      nav={adminNav("tenants")}
      heading={tenant.companyName}
      description={tenant.email}
      userEmail={admin.email}
      actions={
        <Link
          href="/admin/tenants"
          className="inline-flex h-10 items-center rounded-field border border-line-strong bg-field px-4 text-[13px] font-medium transition-colors hover:bg-field-hover"
        >
          All tenants
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Status"
          value={titleCase(tenant.status)}
          meta={`Joined ${dateOnly(tenant.createdAt)}`}
        />
        <StatCard
          label="Minutes used"
          value={tenant.minutesUsed.toLocaleString()}
          meta={cap > 0 ? `${pct}% of ${cap.toLocaleString()}` : "No package"}
        />
        <StatCard
          label="Overage"
          value={overage > 0 ? `${overage.toLocaleString()} min` : "—"}
          meta={
            overage > 0
              ? usd(overage * (tenant.package?.overageRateCents ?? 0))
              : "Within allowance"
          }
        />
        <StatCard
          label="Balance"
          value={usd(tenant.creditBalanceCents)}
          meta={`${tenant._count.agents} agents · ${tenant._count.phoneNumbers} numbers`}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="People">
            <Table>
              <thead>
                <tr>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH align="right">Added</TH>
                </tr>
              </thead>
              <tbody>
                {tenant.users.length === 0 ? (
                  <EmptyRow colSpan={4}>No users yet.</EmptyRow>
                ) : (
                  tenant.users.map((u: TenantMember) => (
                    <tr key={u.id}>
                      <TD className="font-medium">{u.name}</TD>
                      <TD muted>{u.email}</TD>
                      <TD muted>{u.type === "OWNER" ? "Owner" : "Account manager"}</TD>
                      <TD align="right" muted>{dateOnly(u.createdAt)}</TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
            <AddAccountManager tenantId={tenant.id} />
          </Card>

          <Card title="Recent calls">
            <Table>
              <thead>
                <tr>
                  <TH>When</TH>
                  <TH>Agent</TH>
                  <TH>Status</TH>
                  <TH align="right">Duration</TH>
                  <TH align="right">Cost</TH>
                </tr>
              </thead>
              <tbody>
                {recentCalls.length === 0 ? (
                  <EmptyRow colSpan={5}>No calls yet.</EmptyRow>
                ) : (
                  recentCalls.map(c => (
                    <tr key={c.id}>
                      <TD muted>{dateTime(c.startedAt ?? c.createdAt)}</TD>
                      <TD muted>{c.agent?.name ?? "—"}</TD>
                      <TD>
                        <Pill tone={callTone(c.status)}>{titleCase(c.status)}</Pill>
                      </TD>
                      <TD align="right">{duration(c.durationSeconds)}</TD>
                      <TD align="right">{usd(c.costCents)}</TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>

          <Card title="Credit history">
            <Table>
              <thead>
                <tr>
                  <TH>When</TH>
                  <TH>Type</TH>
                  <TH>Tenant sees</TH>
                  <TH>By</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <EmptyRow colSpan={5}>No credit activity yet.</EmptyRow>
                ) : (
                  ledger.map(l => (
                    <tr key={l.id}>
                      <TD muted>{dateTime(l.createdAt)}</TD>
                      <TD muted>{titleCase(l.type)}</TD>
                      <TD muted className="max-w-[240px] truncate">{l.description ?? "—"}</TD>
                      <TD muted className="max-w-[160px] truncate">
                        {l.createdBy ?? "System"}
                      </TD>
                      <TD align="right" className={l.amountCents >= 0 ? "text-success" : undefined}>
                        {l.amountCents >= 0 ? "+" : "−"}
                        {usd(Math.abs(l.amountCents))}
                      </TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </div>

        <Card title="Controls" className="self-start">
          <TenantControls
            tenantId={tenant.id}
            status={tenant.status}
            packageId={tenant.packageId}
            packages={packages}
            balanceCents={tenant.creditBalanceCents}
            crmLocationId={tenant.crmLocationId}
          />
        </Card>
      </div>
    </AppShell>
  )
}
