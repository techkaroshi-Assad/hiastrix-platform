import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, EmptyState } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill } from "@/components/app/table"
import { IconNumbers } from "@/components/app/icons"
import { NumberAssign, type NumberRow } from "./numbers-client"

export const metadata: Metadata = { title: "Phone numbers" }
export const dynamic = "force-dynamic"

export default async function NumbersPage() {
  const { tenant, email } = await requireTenant()

  const [numbers, agents, callCounts] = await Promise.all([
    prisma.phoneNumber.findMany({
      where: { tenantId: tenant.id },
      orderBy: { phoneNumber: "asc" },
      include: { agent: { select: { id: true, name: true } } },
    }),
    prisma.agent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.call.groupBy({
      by: ["phoneNumberId"],
      where: { tenantId: tenant.id },
      _count: { _all: true },
    }),
  ])

  const countBy = new Map(callCounts.map(c => [c.phoneNumberId, c._count._all]))

  const rows: NumberRow[] = numbers.map(n => ({
    id:          n.id,
    phoneNumber: n.phoneNumber,
    status:      n.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    agentId:     n.agent?.id ?? null,
    agentName:   n.agent?.name ?? null,
    calls:       countBy.get(n.id) ?? 0,
  }))

  return (
    <AppShell
      nav={tenantNav("numbers")}
      heading="Phone numbers"
      description="The numbers allocated to your workspace, and the agent answering each."
      userEmail={email}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<IconNumbers />}
          title="No numbers allocated yet"
          body="Phone numbers are allocated to your workspace by the Hi-Astrix team. Once one is assigned to you it will appear here, ready to point at an agent."
        />
      ) : (
        <Card title={`${rows.length} number${rows.length === 1 ? "" : "s"}`}>
          <Table>
            <thead>
              <tr>
                <TH>Number</TH>
                <TH>Status</TH>
                <TH align="right">Calls</TH>
                <TH align="right">Answering agent</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map(n => (
                <tr key={n.id} className="transition-colors hover:bg-field-soft">
                  <TD className="font-medium tabular-nums">{n.phoneNumber}</TD>
                  <TD>
                    <Pill tone={n.status === "ACTIVE" ? "success" : "neutral"}>
                      {n.status === "ACTIVE" ? "Active" : "Inactive"}
                    </Pill>
                  </TD>
                  <TD align="right" muted>
                    {n.calls}
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end">
                      <NumberAssign number={n} agents={agents} />
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </AppShell>
  )
}
