import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { Page } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { SyncButton, AllocateSelect } from "./numbers-admin-client"

export const metadata: Metadata = { title: "Phone numbers" }
export const dynamic = "force-dynamic"

export default async function AdminNumbersPage() {
  const admin = await requireAdmin()

  const [numbers, tenants] = await Promise.all([
    prisma.phoneNumber.findMany({
      orderBy: { phoneNumber: "asc" },
      include: {
        tenant: { select: { id: true, companyName: true } },
        agent:  { select: { name: true } },
      },
    }),
    prisma.tenant.findMany({
      orderBy: { companyName: "asc" },
      select:  { id: true, companyName: true },
    }),
  ])

  const unallocated = numbers.filter(n => !n.tenantId).length

  return (
    <Page
      heading="Phone numbers"
      description="The upstream inventory and who each number belongs to."
      actions={<SyncButton />}
    >
      <Card
        title={`${numbers.length} number${numbers.length === 1 ? "" : "s"}`}
        action={
          <span className="text-[12.5px] text-subtle">
            {unallocated} unallocated
          </span>
        }
      >
        <Table>
          <thead>
            <tr>
              <TH>Number</TH>
              <TH>Status</TH>
              <TH>Answering agent</TH>
              <TH align="right">Allocated to</TH>
            </tr>
          </thead>
          <tbody>
            {numbers.length === 0 ? (
              <EmptyRow colSpan={4}>
                No numbers yet. Use “Sync inventory” to pull them in.
              </EmptyRow>
            ) : (
              numbers.map(n => (
                <tr key={n.id} className="transition-colors hover:bg-field-soft">
                  <TD className="font-medium tabular-nums">{n.phoneNumber}</TD>
                  <TD>
                    <Pill tone={n.status === "ACTIVE" ? "success" : "neutral"}>
                      {n.status === "ACTIVE" ? "Active" : "Inactive"}
                    </Pill>
                  </TD>
                  <TD muted>{n.agent?.name ?? "—"}</TD>
                  <TD align="right">
                    <div className="flex justify-end">
                      <AllocateSelect
                        numberId={n.id}
                        tenantId={n.tenant?.id ?? null}
                        tenants={tenants}
                      />
                    </div>
                  </TD>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </Page>
  )
}
