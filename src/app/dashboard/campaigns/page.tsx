import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, EmptyState } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill } from "@/components/app/table"
import { IconCampaigns } from "@/components/app/icons"
import { CampaignsHeader, campaignTone, type AgentOption } from "./campaigns-client"

export const metadata: Metadata = { title: "Campaigns" }
export const dynamic = "force-dynamic"

const STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  RUNNING: "Calling",
  PAUSED: "Paused",
  COMPLETED: "Finished",
  ARCHIVED: "Archived",
}

export default async function CampaignsPage() {
  const { tenant, email } = await requireTenant()

  const [campaigns, agents, suppressions] = await Promise.all([
    prisma.campaign.findMany({
      where:   { tenantId: tenant.id, state: { not: "ARCHIVED" } },
      orderBy: [{ state: "asc" }, { createdAt: "desc" }],
      include: { agent: { select: { name: true } } },
    }),
    prisma.agent.findMany({
      where:   { tenantId: tenant.id },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, status: true,
        phoneNumbers: { where: { status: "ACTIVE" }, select: { id: true, phoneNumber: true } },
      },
    }),
    prisma.suppression.findMany({
      where:   { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, phoneE164: true, source: true, note: true, createdAt: true },
    }),
  ])

  /*
   * Progress in one query rather than one per campaign.
   *
   * A tenant with twenty campaigns of five thousand leads each would otherwise
   * do twenty grouped counts to render one table.
   */
  const counts = campaigns.length
    ? await prisma.campaignLead.groupBy({
        by: ["campaignId", "state"],
        where: { campaignId: { in: campaigns.map(c => c.id) } },
        _count: { _all: true },
      })
    : []

  const progressOf = (id: string) => {
    const mine = counts.filter(c => c.campaignId === id)
    const total = mine.reduce((n, c) => n + c._count._all, 0)
    const done = mine
      .filter(c => ["COMPLETED", "EXHAUSTED", "FAILED", "SUPPRESSED", "CANCELLED"].includes(c.state))
      .reduce((n, c) => n + c._count._all, 0)
    const talked = mine.find(c => c.state === "COMPLETED")?._count._all ?? 0
    return { total, done, talked }
  }

  const agentOptions: AgentOption[] = agents.map(a => ({
    id: a.id,
    name: a.name,
    active: a.status === "ACTIVE",
    numbers: a.phoneNumbers.map((n: { id: string; phoneNumber: string }) => ({
      id: n.id,
      phoneNumber: n.phoneNumber,
    })),
  }))

  return (
    <AppShell
      nav={tenantNav("campaigns")}
      heading="Campaigns"
      description="Give an agent a list of people and it works through it — paced, retried, and stopped the moment your balance runs out."
      userEmail={email}
      actions={
        <CampaignsHeader
          agents={agentOptions}
          suppressions={suppressions.map(s => ({
            id: s.id,
            phoneE164: s.phoneE164,
            source: s.source,
            note: s.note,
            addedAt: s.createdAt.toISOString(),
          }))}
          canCreate={tenant.status === "ACTIVE" && agents.length > 0}
          lockedReason={
            tenant.status !== "ACTIVE"
              ? "Your workspace isn't active yet."
              : agents.length === 0
                ? "Create an agent first — a campaign is something an agent does."
                : null
          }
        />
      }
    >
      {campaigns.length === 0 ? (
        <EmptyState
          icon={<IconCampaigns />}
          title="No campaigns yet"
          body="A campaign is a list of people and an agent to call them. Upload a spreadsheet or pull a tagged list out of your CRM, set the hours it's allowed to call, and it works through the list on its own."
        />
      ) : (
        <Card title={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`}>
          <Table>
            <thead>
              <tr>
                <TH>Campaign</TH>
                <TH>Agent</TH>
                <TH>Status</TH>
                <TH align="right">Progress</TH>
                <TH align="right">Spoke to</TH>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => {
                const p = progressOf(c.id)
                const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
                return (
                  <tr key={c.id} className="transition-colors hover:bg-field-soft">
                    <TD>
                      <Link
                        href={`/dashboard/campaigns/${c.id}`}
                        className="font-medium text-fg transition-colors hover:text-brand-on-tint"
                      >
                        {c.name}
                      </Link>
                      {c.pausedReason && (
                        <p className="mt-0.5 text-[11.5px] font-light text-muted">{c.pausedReason}</p>
                      )}
                    </TD>
                    <TD muted>{c.agent.name}</TD>
                    <TD>
                      <Pill tone={campaignTone(c.state)}>{STATE_LABEL[c.state] ?? c.state}</Pill>
                    </TD>
                    <TD align="right">
                      <div className="flex items-center justify-end gap-2.5">
                        <span className="tabular-nums text-[12.5px] text-muted">
                          {p.done.toLocaleString()} / {p.total.toLocaleString()}
                        </span>
                        <div
                          className="h-1.5 w-20 overflow-hidden rounded-full bg-field-hover"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${c.name} progress`}
                        >
                          <div
                            className="h-full rounded-full bg-linear-to-r from-brand-400 to-brand-600 transition-[width] duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </TD>
                    <TD align="right" className="tabular-nums">
                      {p.talked.toLocaleString()}
                    </TD>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </AppShell>
  )
}
