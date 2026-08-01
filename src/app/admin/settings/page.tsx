import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { Page } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill } from "@/components/app/table"
import { dateOnly, titleCase } from "@/lib/format"
import { stripeConfigured } from "@/lib/stripe"
import { emailConfigured } from "@/lib/email"
import { crmConfigured } from "@/lib/crm/client"
import { PlatformSettingsForm } from "./settings-client"

export const metadata: Metadata = { title: "Settings" }
export const dynamic = "force-dynamic"

/** Structural subset of AdminUser — the generated row satisfies this. */
type OperatorRow = {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  createdAt: Date
}

export default async function AdminSettingsPage() {
  const admin = await requireAdmin()

  const [settings, admins] = await Promise.all([
    prisma.platformSettings.findFirst({ where: { id: true } }),
    prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } }),
  ])

  // The CRM is the one integration that is not purely an environment variable:
  // the client credentials are, but the agency token is granted at runtime and
  // stored, so "configured" and "connected" are genuinely different states.
  const crmConnection = await prisma.crmConnection.findFirst({
    where:  { id: true },
    select: { companyId: true, connectedBy: true, updatedAt: true },
  })

  const integrations: [string, boolean, string][] = [
    ["Voice platform", Boolean(process.env.VAPI_API_KEY), "VAPI_API_KEY"],
    ["Call webhooks",  Boolean(process.env.VAPI_WEBHOOK_SECRET), "VAPI_WEBHOOK_SECRET"],
    ["Browser calling", Boolean(process.env.VAPI_PUBLIC_KEY), "VAPI_PUBLIC_KEY"],
    ["Payments",       stripeConfigured(), "STRIPE_SECRET_KEY"],
    ["Payment webhooks", Boolean(process.env.STRIPE_WEBHOOK_SECRET), "STRIPE_WEBHOOK_SECRET"],
    ["Email",          emailConfigured(), "RESEND_API_KEY"],
    ["CRM keys",       crmConfigured(), "CRM_CLIENT_ID"],
    // Listed separately because it is easy to set the pair and forget this one,
    // and without it the sub-account picker comes up empty with no clue why.
    ["CRM app",        Boolean(process.env.CRM_APP_ID), "CRM_APP_ID"],
  ]

  return (
    <Page
      heading="Platform settings"
      description="Global defaults, integrations and operator accounts."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Defaults">
          <PlatformSettingsForm
            overageRateCents={settings?.overageRateCents ?? 35}
            lowBalancePct={settings?.lowBalancePct ?? 20}
            supportEmail={settings?.supportEmail ?? "support@hiastrix.com"}
            canEdit={admin.role === "SUPER_ADMIN"}
          />
        </Card>

        <Card title="Integrations">
          <div className="px-5 py-2">
            {integrations.map(([label, ok, envVar]) => (
              <div
                key={envVar}
                className="flex items-center justify-between gap-4 border-b border-line-soft py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-[13px]">{label}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-subtle">{envVar}</div>
                </div>
                <Pill tone={ok ? "success" : "neutral"}>
                  {ok ? "Configured" : "Not set"}
                </Pill>
              </div>
            ))}
          </div>
          {/* The CRM connection, which is state rather than configuration. */}
          <div className="border-t border-line px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13px]">CRM connection</div>
                <div className="mt-0.5 text-[12px] text-subtle">
                  {crmConnection
                    ? `Connected by ${crmConnection.connectedBy ?? "an operator"} on ${dateOnly(crmConnection.updatedAt)}`
                    : "Not connected — tenants cannot be linked to a sub-account yet."}
                </div>
              </div>
              <Pill tone={crmConnection ? "success" : "neutral"}>
                {crmConnection ? "Connected" : "Not connected"}
              </Pill>
            </div>

            {admin.role === "SUPER_ADMIN" && crmConfigured() && (
              <a
                href="/api/admin/crm/connect"
                className="mt-3 inline-flex h-9 items-center rounded-field border border-line px-4 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                {crmConnection ? "Reconnect" : "Connect"}
              </a>
            )}
          </div>

          <p className="border-t border-line px-5 py-4 text-[12.5px] leading-relaxed text-subtle">
            Keys live in the hosting environment and are never shown here. Anything
            marked “Not set” means that capability is simply hidden from tenants
            rather than failing.
          </p>
        </Card>
      </div>

      <div className="mt-5">
        <Card title="Operator accounts">
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
              {admins.map((a: OperatorRow) => (
                <tr key={a.id}>
                  <TD className="font-medium">{a.name}</TD>
                  <TD muted>{a.email}</TD>
                  <TD muted>{titleCase(a.role)}</TD>
                  <TD>
                    <Pill tone={a.isActive ? "success" : "neutral"}>
                      {a.isActive ? "Active" : "Disabled"}
                    </Pill>
                  </TD>
                  <TD align="right" muted>{dateOnly(a.createdAt)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="border-t border-line px-5 py-4 text-[12.5px] leading-relaxed text-subtle">
            Operator accounts are provisioned by hand in the database — there is
            deliberately no signup route for this console. Use{" "}
            <code className="font-mono text-[11.5px] text-muted">create-super-admin.sql</code>{" "}
            in the repository root.
          </p>
        </Card>
      </div>
    </Page>
  )
}
