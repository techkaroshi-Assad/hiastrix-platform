import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { adminNav } from "@/lib/nav-admin"
import { AppShell } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { usd, dateOnly, titleCase } from "@/lib/format"

export const metadata: Metadata = { title: "Tenants" }
export const dynamic = "force-dynamic"

export default async function AdminTenantsPage() {
  const admin = await requireAdmin()

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      package: { select: { name: true, minutesIncluded: true } },
      _count:  { select: { agents: true, users: true, calls: true } },
    },
  })

  return (
    <AppShell
      nav={adminNav("tenants")}
      heading="Tenants"
      description="Every workspace on the platform."
      userEmail={admin.email}
    >
      <Card title={`${tenants.length} tenant${tenants.length === 1 ? "" : "s"}`}>
        <Table>
          <thead>
            <tr>
              <TH>Company</TH>
              <TH>Status</TH>
              <TH>Package</TH>
              <TH align="right">Users</TH>
              <TH align="right">Agents</TH>
              <TH align="right">Calls</TH>
              <TH align="right">Balance</TH>
              <TH align="right">Joined</TH>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <EmptyRow colSpan={8}>No tenants yet.</EmptyRow>
            ) : (
              tenants.map(t => (
                <tr key={t.id} className="transition-colors hover:bg-white/[0.02]">
                  <TD>
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
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
                  <TD align="right" muted>{t._count.users}</TD>
                  <TD align="right" muted>{t._count.agents}</TD>
                  <TD align="right" muted>{t._count.calls}</TD>
                  <TD align="right">{usd(t.creditBalanceCents)}</TD>
                  <TD align="right" muted>{dateOnly(t.createdAt)}</TD>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </AppShell>
  )
}
