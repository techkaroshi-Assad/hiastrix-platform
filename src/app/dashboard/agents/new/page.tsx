import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell } from "@/components/app/app-shell"
import { getVoiceOptions, MODEL_OPTIONS, TRANSCRIBER_OPTIONS } from "@/lib/vapi/catalog"
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
  const voices = await getVoiceOptions()

  return (
    <AppShell
      nav={tenantNav("agents")}
      heading="New agent"
      description="Start from a template or write it yourself. Nothing goes live until you attach a phone number."
      userEmail={email}
    >
      <AgentEditor
        initial={blankDraft(voices, MODEL_OPTIONS)}
        voices={voices}
        models={MODEL_OPTIONS}
        transcribers={TRANSCRIBER_OPTIONS}
        usedForOutbound={false}
      />
    </AppShell>
  )
}
