import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { Page } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill } from "@/components/app/table"
import { dateOnly, titleCase } from "@/lib/format"
import { emailConfigured } from "@/lib/email"
import { CompanyForm, PasswordForm } from "./settings-client"
import { InviteMember, InviteActions } from "./invite-member"

export const metadata: Metadata = { title: "Settings" }
export const dynamic = "force-dynamic"

/** Structural subset — the generated row satisfies this. */
type PendingInvite = {
  id: string
  name: string
  email: string
  createdAt: Date
  expiresAt: Date
}

export default async function SettingsPage() {
  const { tenant, email, role } = await requireTenant()

  const [team, invitations] = await Promise.all([
    prisma.tenantUser.findMany({
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
    }),
    prisma.tenantInvitation.findMany({
      where:   { tenantId: tenant.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select:  { id: true, email: true, name: true, expiresAt: true, createdAt: true },
    }),
  ])

  const statusTone =
    tenant.status === "ACTIVE"
      ? "success"
      : tenant.status === "PENDING"
        ? "warning"
        : "danger"

  return (
    <Page
      heading="Settings"
      description="Your workspace details and account security."
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
                <tr key={member.id} className="transition-colors hover:bg-field-soft">
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
          {role === "OWNER" && <InviteMember />}
        </Card>
      </div>

      {/* Only shown when there is something outstanding — an empty "pending"
          table on every visit is noise. */}
      {role === "OWNER" && invitations.length > 0 && (
        <div className="mt-5">
          <Card title={`${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}`}>
            <Table>
              <thead>
                <tr>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Invited</TH>
                  <TH>Expires</TH>
                  <TH align="right">Actions</TH>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invite: PendingInvite) => (
                  <tr key={invite.id} className="transition-colors hover:bg-field-soft">
                    <TD className="font-medium">{invite.name}</TD>
                    <TD muted>{invite.email}</TD>
                    <TD muted>{dateOnly(invite.createdAt)}</TD>
                    <TD muted>{dateOnly(invite.expiresAt)}</TD>
                    <TD align="right">
                      <InviteActions id={invite.id} canResend={emailConfigured()} />
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </Page>
  )
}
