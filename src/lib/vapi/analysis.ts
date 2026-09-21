/**
 * The post-call analysis plan, with the one thing the default prompts
 * leave out: who is who.
 *
 * Vapi's default extraction prompt is "You will be given a transcript of a
 * call. Extract structured data per the JSON Schema." On an outbound call
 * the transcript starts with the *assistant* introducing itself, and a
 * field called "caller name" gets the assistant's name — which is exactly
 * what happened on every call of the first production campaign. The model
 * was not wrong; it was never told the assistant placed the call.
 *
 * So every plan we send says which lines are the assistant, which are the
 * other party, and — when we know it — who dialled whom. The base assistant
 * does not know its direction (one assistant answers inbound and dials
 * campaigns), so it gets the neutral version. Campaign calls override it
 * per call with the outbound version, via `assistantOverrides.analysisPlan`
 * in lib/dialer/consent.ts.
 *
 * `{{transcript}}`, `{{endedReason}}` and `{{schema}}` are the provider's
 * own template variables for these messages, the same ones its default
 * prompts use. If `{{schema}}` ever stops being substituted the schema is
 * still sent on `structuredDataPlan.schema`, so extraction degrades to
 * "prompt has a literal placeholder in it" rather than to nothing.
 */

import type { AgentConfig } from "@/lib/vapi/config"

export type CallPerspective = "inbound" | "outbound" | "unknown"

const WHO_IS_WHO =
  "Who is who: lines labelled \"AI\" (or \"assistant\"/\"bot\") are the AI assistant. " +
  "Lines labelled \"User\" (or \"customer\") are the other party on the line. " +
  "Every field about a person — a name, a phone number, a role, what they want, how interested they are — " +
  "refers to the OTHER PARTY, never to the assistant, and never the assistant's own name. " +
  "If an automated phone menu or a voicemail greeting answered and no person ever spoke, say so in the relevant fields rather than inventing a person."

const PERSPECTIVE: Record<CallPerspective, string> = {
  outbound:
    "Direction: the assistant PLACED this call to a number on a calling list. " +
    "The other party is whoever answered at that number: a receptionist or gatekeeper, an automated menu, a voicemail, or the person the assistant was trying to reach. " +
    "The assistant is the salesperson here; the other party is the prospect.",
  inbound:
    "Direction: the other party CALLED IN and the assistant answered.",
  unknown: "",
}

function systemFor(perspective: CallPerspective): string {
  return [WHO_IS_WHO, PERSPECTIVE[perspective]].filter(Boolean).join("\n\n")
}

const TRANSCRIPT_USER_MESSAGE =
  "Here is the transcript:\n\n{{transcript}}\n\nHere is the ended reason of the call:\n\n{{endedReason}}\n\n"

export function analysisPlanPayload(
  config: Pick<AgentConfig, "summaryEnabled" | "successEvaluationEnabled" | "structuredDataEnabled" | "structuredDataSchema">,
  opts: { perspective: CallPerspective }
): Record<string, unknown> {
  const who = systemFor(opts.perspective)

  const plan: Record<string, unknown> = {}

  if (config.summaryEnabled) {
    plan.summaryPlan = {
      enabled: true,
      messages: [
        {
          role: "system",
          content:
            "You are an expert note-taker. You will be given a transcript of a phone call. " +
            "Summarize it in 2-3 sentences for the person who runs the assistant: who answered, what was learned, and what happens next. " +
            "Refer to the AI as \"the agent\". Do not describe the agent as \"the caller\".\n\n" + who,
        },
        { role: "user", content: TRANSCRIPT_USER_MESSAGE },
      ],
    }
  }

  if (config.successEvaluationEnabled) {
    plan.successEvaluationPlan = { enabled: true }
  }

  if (config.structuredDataEnabled && config.structuredDataSchema.trim()) {
    plan.structuredDataPlan = {
      enabled: true,
      schema: JSON.parse(config.structuredDataSchema),
      messages: [
        {
          role: "system",
          content:
            "You are an expert data extractor. You will be given a transcript of a phone call. " +
            "Extract structured data per the JSON Schema. DO NOT return anything except the JSON.\n\n" +
            who + "\n\n" +
            "Where a field's description lists allowed values (\"exactly one of\"), answer with one of those values verbatim.\n\n" +
            "Json Schema:\n{{schema}}\n\nOnly respond with the JSON.",
        },
        { role: "user", content: TRANSCRIPT_USER_MESSAGE },
      ],
    }
  }

  return plan
}
