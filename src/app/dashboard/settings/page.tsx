import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill } from "@/components/app/table"
import { dateOnly, titleCase } from "@/lib/format"
import { CompanyForm, PasswordForm } from "./settings-client"

export const metadata: Metadata = { title: "Settings" }
export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const { tenant, email, role } = await requireTenant()

  const team = await prisma.tenantUser.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      type: true,
      isActive: true,
      createdAt: true,
    },
  })

  const statusTone =
    tenant.status === "ACTIVE"
      ? "success"
      : tenant.status === "PENDING"
        ? "warning"
        : "danger"

  return (
    <AppShell
      nav={tenantNav("settings")}
      heading="Settings"
      description="Your workspace details and account security."
      userEmail={email}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Workspace"
          action={<Pill tone={statusTone}>{titleCase(tenant.status)}</Pill>}
        >
          <CompanyForm initial={tenant.companyName} canEdit={role === "OWNER"} />
        </Card>

        <Card title="Password">
          <PasswordForm />
        </Card>
      </div>

      <div className="mt-5">
        <Card title="People with access">
          <Table>
            <thead>
              <tr>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH align="right">Added</TH>
              </tr>
            </thead>
            <tbody>
              {team.map(member => (
                <tr key={member.id} className="transition-colors hover:bg-white/[0.02]">
                  <TD className="font-medium">{member.name}</TD>
                  <TD muted>{member.email}</TD>
                  <TD muted>
                    {member.type === "OWNER" ? "Owner" : "Account manager"}
                  </TD>
                  <TD>
                    <Pill tone={member.isActive ? "success" : "neutral"}>
                      {member.isActive ? "Active" : "Disabled"}
                    </Pill>
                  </TD>
                  <TD align="right" muted>
                    {dateOnly(member.createdAt)}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="border-t border-white/[0.06] px-5 py-4 text-[12.5px] text-subtle">
            Account managers are added by the Hi-Astrix team. Contact support if you
            need someone added or removed.
          </p>
        </Card>
      </div>
    </AppShell>
  )
}
