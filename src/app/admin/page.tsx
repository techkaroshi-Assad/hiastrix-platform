import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { Page, StatCard } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { usd, titleCase } from "@/lib/format"

export const metadata: Metadata = { title: "Admin" }
export const dynamic = "force-dynamic"

export default async function AdminOverviewPage() {
  const admin = await requireAdmin()

  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [tenants, callsToday, monthAgg, revenueAgg] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        package: { select: { name: true, minutesIncluded: true } },
        _count:  { select: { agents: true } },
      },
    }),
    prisma.call.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.call.aggregate({
      where: { createdAt: { gte: startOfMonth } },
      _count: { _all: true },
      _sum:   { minutesBilled: true },
    }),
    prisma.payment.aggregate({
      where: { status: "COMPLETED", createdAt: { gte: startOfMonth } },
      _sum:  { amountCents: true },
    }),
  ])

  // Tenants at or past 80% of their allowance need attention.
  const atRisk = tenants.filter(t => {
    const cap = t.package?.minutesIncluded ?? 0
    return cap > 0 && t.minutesUsed / cap >= 0.8
  })

  return (
    <Page
      heading="Operations"
      description={`Signed in as ${titleCase(admin.role)}.`}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tenants" value={String(tenants.length)} meta={`${tenants.filter(t => t.status === "ACTIVE").length} active`} />
        <StatCard label="Calls today" value={String(callsToday)} meta={`${monthAgg._count._all} this month`} />
        <StatCard label="Minutes this month" value={String(monthAgg._sum.minutesBilled ?? 0)} meta="Billed across all tenants" />
        <StatCard label="Revenue this month" value={usd(revenueAgg._sum.amountCents ?? 0)} meta="Completed payments" />
      </div>

      {atRisk.length > 0 && (
        <div className="mt-5">
          <Card title={`${atRisk.length} tenant${atRisk.length === 1 ? "" : "s"} near their cap`}>
            <Table>
              <thead>
                <tr>
                  <TH>Tenant</TH>
                  <TH>Package</TH>
                  <TH align="right">Used</TH>
                  <TH align="right">Balance</TH>
                </tr>
              </thead>
              <tbody>
                {atRisk.map(t => {
                  const cap = t.package?.minutesIncluded ?? 0
                  const pct = cap > 0 ? Math.round((t.minutesUsed / cap) * 100) : 0
                  return (
                    <tr key={t.id} className="transition-colors hover:bg-field-soft">
                      <TD>
                        <Link href={`/admin/tenants/${t.id}`} className="underline-offset-4 hover:underline">
                          {t.companyName}
                        </Link>
                      </TD>
                      <TD muted>{t.package?.name ?? "—"}</TD>
                      <TD align="right">
                        <Pill tone={pct >= 100 ? "danger" : "warning"}>{pct}%</Pill>
                      </TD>
                      <TD align="right">{usd(t.creditBalanceCents)}</TD>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      <div className="mt-5">
        <Card
          title="All tenants"
          action={
            <Link
              href="/admin/tenants"
              className="text-[12.5px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
            >
              Manage
            </Link>
          }
        >
          <Table>
            <thead>
              <tr>
                <TH>Company</TH>
                <TH>Status</TH>
                <TH>Package</TH>
                <TH align="right">Agents</TH>
                <TH align="right">Minutes</TH>
                <TH align="right">Balance</TH>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <EmptyRow colSpan={6}>No tenants yet.</EmptyRow>
              ) : (
                tenants.map(t => (
                  <tr key={t.id} className="transition-colors hover:bg-field-soft">
                    <TD>
                      <Link href={`/admin/tenants/${t.id}`} className="font-medium underline-offset-4 hover:underline">
                        {t.companyName}
                      </Link>
                      <div className="mt-0.5 text-[12px] text-subtle">{t.email}</div>
                    </TD>
                    <TD>
                      <Pill
                        tone={
                          t.status === "ACTIVE" ? "success"
                          : t.status === "PENDING" ? "warning"
                          : "danger"
                        }
                      >
                        {titleCase(t.status)}
                      </Pill>
                    </TD>
                    <TD muted>{t.package?.name ?? "—"}</TD>
                    <TD align="right" muted>{t._count.agents}</TD>
                    <TD align="right" muted>{t.minutesUsed.toLocaleString()}</TD>
                    <TD align="right">{usd(t.creditBalanceCents)}</TD>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </div>
    </Page>
  )
}
