import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell } from "@/components/app/app-shell"
import { getVoiceOptions, getModelOptions, MODEL_OPTIONS, TRANSCRIBER_OPTIONS } from "@/lib/vapi/catalog"
import { AgentEditor } from "../agent-editor"
import { blankDraft } from "../draft"

export const metadata: Metadata = { title: "New agent" }
export const dynamic = "force-dynamic"

export default async function NewAgentPage() {
  const { tenant, email } = await requireTenant()
  if (tenant.status !== "ACTIVE") redirect("/dashboard/agents")

  // From the account rather than a hardcoded list — the provider retires
  // voices, and a retired one pre-selected into a new agent fails at save time
  // with an error nobody can act on.
  // Both from the account rather than a hardcoded list. Models now include
  // everything OpenRouter can reach, since a key attached there widens the
  // choice without anyone deploying.
  const [voices, models] = await Promise.all([getVoiceOptions(), getModelOptions()])

  return (
    <AppShell
      nav={tenantNav("agents")}
      heading="New agent"
      description="Start from a template or write it yourself. Nothing goes live until you attach a phone number."
      userEmail={email}
    >
      <AgentEditor
        initial={blankDraft(voices, models)}
        voices={voices}
        models={models}
        transcribers={TRANSCRIBER_OPTIONS}
        usedForOutbound={false}
      />
    </AppShell>
  )
}
