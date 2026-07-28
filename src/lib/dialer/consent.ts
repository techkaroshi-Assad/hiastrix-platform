/**
 * The line the agent must say on an outbound campaign call — SERVER ONLY.
 *
 * ── WHY THIS IS PER-CALL AND NOT PART OF THE AGENT ────────────────────
 *
 * The obvious place to put it is the assistant's stored system prompt, appended
 * the same way the CRM rules are in `payload.ts`. That is wrong here for two
 * reasons.
 *
 * An agent takes inbound calls as well as making outbound ones, and the same
 * agent may sit behind three campaigns and a phone number. Baking a campaign's
 * obligation into the assistant would put it on every inbound call too, and
 * would mean re-pushing the assistant to the provider every time a campaign
 * starts or stops — a write to a shared object triggered by an unrelated action,
 * which is exactly how two campaigns end up fighting over one agent's prompt.
 *
 * So it rides on the call instead, as an override, and it applies to precisely
 * the calls this platform initiated. The tenant's own prompt is untouched, in
 * their editor and at the provider.
 *
 * ── WHY IT CANNOT BE EDITED OUT ───────────────────────────────────────
 *
 * It is composed here, at dial time, from `platform_settings.consent_line`. It
 * never passes through the agent form or the JSON editor, so there is nothing
 * for a tenant to delete. Placing a call is the only way to see it.
 */

import { enforcedRules } from "@/lib/crm/guidance"
import { readConfig } from "@/lib/vapi/config"

/**
 * The system prompt the agent should run with on this call.
 *
 * Mirrors what `payload.ts` sends when the assistant is saved — the tenant's
 * prompt plus the enforced CRM rules — and then adds the campaign obligations
 * on top. It has to mirror it rather than merely append, because an override
 * replaces the message wholesale: send only the extra line and the agent loses
 * its own instructions and its CRM discipline mid-campaign.
 */
export function campaignSystemPrompt(a: {
  agentSystemPrompt: string | null
  agentConfig: unknown
  consentLine: string
  campaignName: string
}): string {
  const config = readConfig(a.agentConfig)

  const base = (a.agentSystemPrompt ?? "").trim() + enforcedRules(config.tools)

  const obligations: string[] = []

  const consent = a.consentLine.trim()
  if (consent) obligations.push(consent)

  obligations.push(
    "You called them, so say who you are and why you are calling before you ask them anything.",
    "If they ask not to be contacted again, say you will take them off the list, use the opt-out tool if you have it, and end the call politely. Do not try to keep them talking.",
    "If they are busy or it is a bad time, offer to call back and end the call."
  )

  return `${base}\n\n${obligations.map(o => `- ${o}`).join("\n")}`
}

/**
 * The override block sent with an outbound campaign call.
 *
 * `model.messages` replaces the assistant's own system message for this call
 * only. Everything else about the assistant — voice, tools, transcriber — is
 * left alone, so a campaign changes what the agent is obliged to say and nothing
 * about how it works.
 */
export function campaignOverrides(a: {
  agentSystemPrompt: string | null
  agentConfig: unknown
  consentLine: string
  campaignName: string
  contactName: string | null
  fields: Record<string, unknown>
  /** Set when the campaign leaves voicemails, so the agent knows what to say. */
  voicemailMessage?: string | null
}): Record<string, unknown> {
  const overrides: Record<string, unknown> = {
    model: {
      messages: [{ role: "system", content: campaignSystemPrompt(a) }],
    },
    variableValues: {
      name: a.contactName ?? "",
      campaign: a.campaignName,
      ...Object.fromEntries(
        Object.entries(a.fields).map(([k, v]) => [k, String(v ?? "")])
      ),
    },
  }

  if (a.voicemailMessage?.trim()) {
    overrides.voicemailMessage = a.voicemailMessage.trim()
  }

  return overrides
}
