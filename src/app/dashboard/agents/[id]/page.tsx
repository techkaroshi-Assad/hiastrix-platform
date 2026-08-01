import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { Page } from "@/components/app/app-shell"
import { readConfig, DEFAULT_CONFIG } from "@/lib/vapi/config"
import { getVoiceOptions, getModelOptions, MODEL_OPTIONS, TRANSCRIBER_OPTIONS } from "@/lib/vapi/catalog"
import { AgentEditor } from "../agent-editor"

export const metadata: Metadata = { title: "Edit agent" }
export const dynamic = "force-dynamic"

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { tenant } = await requireTenant()

  const [agent, voices, models] = await Promise.all([
    prisma.agent.findFirst({
      where: { id, tenantId: tenant.id },
      include: {
        phoneNumbers: { select: { phoneNumber: true } },
        // Whether a campaign points at this agent changes what the checker
        // says: an agent that makes outbound calls and can't recognise an
        // answering machine records answerphones as real conversations.
        campaigns: {
          where:  { state: { not: "ARCHIVED" } },
          select: { id: true },
          take: 1,
        },
      },
    }),
    getVoiceOptions(),
    getModelOptions(),
  ])
  if (!agent) notFound()

  const numbers = agent.phoneNumbers.map((n: { phoneNumber: string }) => n.phoneNumber)

  return (
    <Page
      heading={agent.name}
      description={
        numbers.length
          ? `Answering on ${numbers.join(", ")}. Changes apply to the next call.`
          : "No phone number attached yet, so it can't take or make calls."
      }
    >
      <AgentEditor
        agentId={agent.id}
        initial={{
          name:                 agent.name,
          systemPrompt:         agent.systemPrompt ?? "",
          firstMessage:         agent.firstMessage ?? "",
          voice:                agent.voice ?? voices[0]?.value ?? "",
          model:                agent.model ?? MODEL_OPTIONS[0]?.value ?? "",
          recordingEnabled:     agent.recordingEnabled,
          transcriptionEnabled: agent.transcriptionEnabled,
          // Merged over the defaults so an agent saved before a setting existed
          // opens with that setting at its default rather than undefined.
          config:               { ...DEFAULT_CONFIG, ...readConfig(agent.config) },
        }}
        voices={voices}
        models={models}
        transcribers={TRANSCRIBER_OPTIONS}
        usedForOutbound={agent.campaigns.length > 0}
      />
    </Page>
  )
}
