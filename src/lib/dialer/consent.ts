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

import { splitOption } from "@/lib/vapi/options"
import { enforcedRules } from "@/lib/crm/guidance"
import { readConfig } from "@/lib/vapi/config"
import { effectiveTimeZone, toolsPayload } from "@/lib/vapi/payload"
import { formatLeadContext, type LeadContext } from "@/lib/crm/lead-context"

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
  leadContext: LeadContext
}): string {
  const config = readConfig(a.agentConfig)

  // Same timezone the assistant is actually built with (see
  // lib/vapi/payload.ts) — omitting this here meant every campaign call
  // computed "today" and "tomorrow" against UTC regardless of the agent's own
  // calendar, which is exactly the class of bug the date block exists to
  // prevent in the first place.
  const base = (a.agentSystemPrompt ?? "").trim()
    + enforcedRules(config.tools, { timeZone: effectiveTimeZone(config) })

  const { promptBlock } = formatLeadContext(a.leadContext)

  const obligations: string[] = []

  const consent = a.consentLine.trim()
  if (consent) obligations.push(consent)

  obligations.push(
    "You called them, so say who you are and why you are calling before you ask them anything.",
    /*
     * Not the same instruction for a B2B list as for a consumer one, and
     * treating it as the same is how a real call went wrong: the name on
     * file was the practice's own doctor, a receptionist answered, and the
     * old fixed wording here said to address whoever picked up by that name
     * in the first sentence — exactly the hallucination this platform
     * exists to prevent, just aimed at business calls instead of CRM
     * lookups. The model quietly ignored the bad instruction rather than
     * greet a receptionist as "Doctor" — the right outcome, but by luck of
     * good judgement rather than by what it was told to do.
     *
     * Now a real choice rather than one guess baked into every call: see
     * `leadContactRelationship` in lib/vapi/config.ts. "direct" is a
     * personal contact list — a first name is very likely who answers.
     * "front-desk" is a directory of business lines — the name is who to
     * ask for, not who's on the line by default.
     */
    a.leadContext.name
      ? config.leadContactRelationship === "front-desk"
        ? `You have a name on file for this call — ${a.leadContext.name}. This is a business line, so whoever answers first is usually reception or other staff, not ${a.leadContext.name} — don't assume they are. Ask for ${a.leadContext.name} by name, or whoever handles this, rather than guessing who's on the line.`
        : `Address them by name — ${a.leadContext.name} — starting with your first sentence, rather than asking who they are.`
      : "You have not been given a name for this call. Ask who you're speaking with naturally rather than guessing one.",
    "If they ask not to be contacted again, say you will take them off the list, use the opt-out tool if you have it, and use your endCall function to end the call politely — right away, not after another push. Do not try to keep them talking.",
    "If they are busy or it is a bad time, offer to call back, then use your endCall function to end the call."
  )

  return `${base}\n\n${promptBlock}\n\n${obligations.map(o => `- ${o}`).join("\n")}`
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
  /**
   * The agent's own model, as `provider:id`.
   *
   * Required, and the reason is worth stating plainly: the provider validates
   * `assistantOverrides.model` as a complete model object, so sending only
   * `messages` is rejected with
   *
   *   assistantOverrides.model.provider must be one of the following values: …
   *
   * That is a 400 on the call itself, not a warning — so every outbound call a
   * campaign ever placed failed before it rang, nine in a row, all recorded as
   * "We couldn't place a call to this number". Naming the agent's existing
   * model changes nothing about its behaviour; it only makes the override a
   * legal object.
   */
  agentModel: string | null
  consentLine: string
  campaignName: string
  /** Everything known about who is being called — CSV columns, and a CRM
   *  match if one was found before dialling. See lib/crm/lead-context.ts. */
  leadContext: LeadContext
  /** Set when the campaign leaves voicemails, so the agent knows what to say. */
  voicemailMessage?: string | null
}): Record<string, unknown> {
  // Its own model, repeated back. `splitOption` defaults an unprefixed value to
  // the provider's own namespace, which is also the right fallback for an agent
  // saved before models carried a prefix.
  const m = splitOption(a.agentModel?.trim() || "gpt-4o-mini")
  const { variableValues } = formatLeadContext(a.leadContext)
  const config = readConfig(a.agentConfig)

  const overrides: Record<string, unknown> = {
    model: {
      provider: m.provider,
      model:    m.id,
      messages: [{ role: "system", content: campaignSystemPrompt(a) }],
      /*
       * Without this, every campaign call ran with none of the agent's
       * tools — this object replaces the assistant's `model` for the call
       * rather than merging into it, so omitting `tools` here silently
       * dropped CRM actions, the knowledge search tool, and the endCall
       * function on every single outbound dial. Mirrors exactly what the
       * base assistant gets built with in lib/vapi/payload.ts, so a
       * campaign call and a direct inbound call have the same capabilities.
       */
      tools: toolsPayload(config),
      ...(config.knowledgeToolId ? { toolIds: [config.knowledgeToolId] } : {}),
    },
    variableValues: {
      ...variableValues,
      campaign: a.campaignName,
    },
  }

  if (a.voicemailMessage?.trim()) {
    overrides.voicemailMessage = a.voicemailMessage.trim()
  }

  return overrides
}
