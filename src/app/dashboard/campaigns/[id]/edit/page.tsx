import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell } from "@/components/app/app-shell"
import { CampaignForm, type AgentOption, type CampaignValues } from "../../campaign-form"

export const metadata: Metadata = { title: "Edit campaign" }
export const dynamic = "force-dynamic"

/**
 * Changing a campaign, including while it is running.
 *
 * Running is deliberately allowed. Realising at eleven o'clock that the calling
 * window is an hour too early, or that three at once is too many, is exactly
 * when someone needs to change it — and the alternative is stopping the
 * campaign, which loses nothing but feels like it might.
 *
 * The claim re-reads these settings on every pass, so a change takes effect on
 * the next call rather than needing a restart.
 */
export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { tenant, email } = await requireTenant()

  const campaign = await prisma.campaign.findFirst({
    where:  { id, tenantId: tenant.id },
    select: {
      id: true, name: true, agentId: true, phoneNumberId: true, state: true,
      timezone: true, windowStart: true, windowEnd: true, windowDays: true,
      maxConcurrent: true, maxAttempts: true,
      voicemailPolicy: true, voicemailMessage: true,
      startedAt: true,
    },
  })
  if (!campaign) notFound()

  // An archived campaign is a record, not a plan. Nothing about it is editable.
  if (campaign.state === "ARCHIVED") redirect(`/dashboard/campaigns/${id}`)

  const agents = await prisma.agent.findMany({
    where:   { tenantId: tenant.id },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, status: true, config: true,
      phoneNumbers: { where: { status: "ACTIVE" }, select: { id: true, phoneNumber: true } },
    },
  })

  const options: AgentOption[] = agents.map(a => {
    const cfg = (a.config ?? {}) as { voicemailDetectionEnabled?: unknown }
    return {
      id: a.id,
      name: a.name,
      active: a.status === "ACTIVE",
      voicemailDetection: cfg.voicemailDetectionEnabled === true,
      numbers: a.phoneNumbers.map((n: { id: string; phoneNumber: string }) => ({
        id: n.id, phoneNumber: n.phoneNumber,
      })),
    }
  })

  const initial: CampaignValues = {
    name: campaign.name,
    agentId: campaign.agentId,
    phoneNumberId: campaign.phoneNumberId ?? "",
    timezone: campaign.timezone,
    windowStart: campaign.windowStart,
    windowEnd: campaign.windowEnd,
    windowDays: campaign.windowDays,
    maxConcurrent: campaign.maxConcurrent,
    maxAttempts: campaign.maxAttempts,
    voicemailPolicy: campaign.voicemailPolicy,
    voicemailMessage: campaign.voicemailMessage ?? "",
  }

  return (
    <AppShell
      nav={tenantNav("campaigns")}
      heading={`Edit ${campaign.name}`}
      description={
        campaign.state === "RUNNING"
          ? "This campaign is calling right now. Changes take effect on the next call — you don't need to stop it."
          : "Changes are saved straight away."
      }
      userEmail={email}
    >
      <CampaignForm
        agents={options}
        initial={initial}
        campaignId={campaign.id}
        hasRun={Boolean(campaign.startedAt)}
      />
    </AppShell>
  )
}
