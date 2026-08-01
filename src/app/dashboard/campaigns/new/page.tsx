import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { Page } from "@/components/app/app-shell"
import { CampaignForm, type AgentOption } from "../campaign-form"

export const metadata: Metadata = { title: "New campaign" }
export const dynamic = "force-dynamic"

/**
 * A page, not a slide-over.
 *
 * This started life inside a 520px `<Panel>`, which is the right shape for a
 * short form and the wrong one for this: name, agent, caller ID, time zone,
 * calling hours, weekdays, concurrency, attempts and voicemail policy do not
 * belong in a column that narrow. Everything was legible and nothing had room
 * to breathe.
 *
 * The Panel is still right for adding people and for the do-not-call list —
 * both are one job with one control.
 */
export default async function NewCampaignPage() {
  const { tenant } = await requireTenant()

  if (tenant.status !== "ACTIVE") redirect("/dashboard/campaigns")

  const agents = await prisma.agent.findMany({
    where:   { tenantId: tenant.id },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, status: true, config: true,
      phoneNumbers: {
        where:  { status: "ACTIVE" },
        select: { id: true, phoneNumber: true },
      },
    },
  })

  if (!agents.length) redirect("/dashboard/campaigns")

  const options: AgentOption[] = agents.map(a => {
    const cfg = (a.config ?? {}) as { voicemailDetectionEnabled?: unknown }
    return {
      id: a.id,
      name: a.name,
      active: a.status === "ACTIVE",
      // Surfaced here so the form can warn before the campaign is created,
      // rather than the start button refusing later with the same message.
      voicemailDetection: cfg.voicemailDetectionEnabled === true,
      numbers: a.phoneNumbers.map((n: { id: string; phoneNumber: string }) => ({
        id: n.id,
        phoneNumber: n.phoneNumber,
      })),
    }
  })

  return (
    <Page
      heading="New campaign"
      description="It starts empty and paused. You'll add people next, then start it when you're ready — nothing is dialled before that."
    >
      <CampaignForm agents={options} />
    </Page>
  )
}
