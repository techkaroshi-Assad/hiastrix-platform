import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell } from "@/components/app/app-shell"
import { readConfig } from "@/lib/vapi/config"
import { AgentsClient, type AgentRow, type NumberRow } from "./agents-client"

export const metadata: Metadata = { title: "Agents" }
export const dynamic = "force-dynamic"

export default async function AgentsPage() {
  const { tenant, email } = await requireTenant()

  const [agents, numbers, callStats] = await Promise.all([
    prisma.agent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      include: { phoneNumbers: { select: { id: true, phoneNumber: true } } },
    }),
    prisma.phoneNumber.findMany({
      where: { tenantId: tenant.id },
      orderBy: { phoneNumber: "asc" },
      select: { id: true, phoneNumber: true, agentId: true },
    }),
    prisma.call.groupBy({
      by: ["agentId"],
      where: { tenantId: tenant.id },
      _count: { _all: true },
      _sum: { minutesBilled: true, durationSeconds: true },
    }),
  ])

  const statsByAgent = new Map(
    callStats.map(s => [
      s.agentId,
      {
        calls:   s._count._all,
        minutes: s._sum.minutesBilled ?? 0,
        seconds: s._sum.durationSeconds ?? 0,
      },
    ])
  )

  const rows: AgentRow[] = agents.map(a => {
    const s = statsByAgent.get(a.id)
    const assigned = a.phoneNumbers[0] ?? null
    return {
      id:                   a.id,
      name:                 a.name,
      status:               a.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      voice:                a.voice,
      model:                a.model,
      systemPrompt:         a.systemPrompt,
      firstMessage:         a.firstMessage,
      recordingEnabled:     a.recordingEnabled,
      transcriptionEnabled: a.transcriptionEnabled,
      config:               readConfig(a.config),
      phoneNumberId:        assigned?.id ?? null,
      phoneNumberLabel:     assigned?.phoneNumber ?? null,
      calls:                s?.calls ?? 0,
      minutes:              s?.minutes ?? 0,
      avgSeconds:           s && s.calls > 0 ? Math.round(s.seconds / s.calls) : 0,
    }
  })

  const numberRows: NumberRow[] = numbers

  const canCreate = tenant.status === "ACTIVE"
  const lockedReason =
    tenant.status === "PENDING"
      ? "Your workspace is still being activated. You can look around now — agent creation unlocks as soon as your package is confirmed."
      : tenant.status === "BLOCKED"
        ? "This workspace is suspended. Please contact support to restore access."
        : tenant.status === "INACTIVE"
          ? "This workspace is inactive. Contact support to reactivate it."
          : undefined

  return (
    <AppShell
      nav={tenantNav("agents")}
      heading="Agents"
      description="The voices that answer and place your calls."
      userEmail={email}
    >
      <AgentsClient
        agents={rows}
        numbers={numberRows}
        canCreate={canCreate}
        lockedReason={lockedReason}
        browserCallEnabled={Boolean(process.env.VAPI_PUBLIC_KEY)}
      />
    </AppShell>
  )
}
