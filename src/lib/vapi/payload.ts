/**
 * Translation from our stored agent record into Vapi's nested assistant payload.
 *
 * SERVER ONLY — reads VAPI_WEBHOOK_SECRET. Never import this from a client
 * component; import from ./config.ts instead.
 *
 * Kept in one place so create and update can never drift apart.
 *
 * The `server` block is set by us, never by the tenant: it points Vapi at our
 * webhook and carries the shared secret. Without it no call is ever recorded
 * and nothing is ever billed, so it is attached to every assistant we write.
 */

import { splitOption } from "./options"
import { transcriberPayload } from "./catalog"
import type { AgentConfig } from "./config"
import type { AgentTool } from "./tools"

/* ── Tools ─────────────────────────────────────────────────────────────── */

/** One of our tools → one provider tool object. */
function toolPayload(tool: AgentTool): Record<string, unknown> {
  const fn: Record<string, unknown> = {
    name: tool.name,
    description: tool.description,
  }

  switch (tool.type) {
    case "function": {
      // Expand our typed parameter list into the JSON Schema object the
      // provider expects. The object wrapper is required even with no
      // properties.
      const properties: Record<string, unknown> = {}
      for (const p of tool.parameters) {
        properties[p.name] = {
          type: p.type,
          ...(p.description ? { description: p.description } : {}),
        }
      }
      const required = tool.parameters.filter(p => p.required).map(p => p.name)

      return {
        type: "function",
        function: {
          ...fn,
          parameters: {
            type: "object",
            properties,
            ...(required.length ? { required } : {}),
          },
        },
        // Each function tool names its own destination, so a tool call never
        // falls back to OUR assistant-level server block — which is subscribed
        // to call lifecycle events, not tool calls, and would leave the caller
        // listening to silence.
        server: {
          url: tool.serverUrl,
          ...(tool.serverSecret
            ? { headers: { "x-tool-secret": tool.serverSecret } }
            : {}),
        },
        ...(tool.waitingMessage
          ? { messages: [{ type: "request-start", content: tool.waitingMessage }] }
          : {}),
      }
    }

    case "gohighlevel.contact.get":
    case "gohighlevel.contact.create":
      return { type: tool.type, function: fn }

    case "gohighlevel.calendar.availability.check":
      return {
        type: tool.type,
        function: fn,
        metadata: { calendarId: tool.calendarId, timeZone: tool.timeZone },
      }

    case "gohighlevel.calendar.event.create":
      return {
        type: tool.type,
        function: fn,
        metadata: { calendarId: tool.calendarId },
      }
  }
}

const toolName = (t: Record<string, unknown>) =>
  (t?.function as { name?: string } | undefined)?.name

/**
 * Structured tools first, then any un-migrated legacy JSON, de-duped by name.
 *
 * Emitting both is what makes the one-off migration safe: an agent's effective
 * tool list is identical before and after conversion, so nothing needs
 * re-syncing upstream.
 */
function toolsPayload(config: AgentConfig): Record<string, unknown>[] {
  const structured = config.tools.map(toolPayload)
  if (!config.toolsJson.trim()) return structured

  const taken = new Set(structured.map(toolName))

  let legacy: unknown = []
  try {
    legacy = JSON.parse(config.toolsJson)
  } catch {
    legacy = []
  }
  if (!Array.isArray(legacy)) return structured

  return [
    ...structured,
    ...(legacy as Record<string, unknown>[]).filter(t => !taken.has(toolName(t))),
  ]
}

export type AgentCore = {
  name: string
  systemPrompt: string
  firstMessage: string
  voice: string
  model: string
  recordingEnabled: boolean
  transcriptionEnabled: boolean
}

/**
 * Where Vapi should send call events, and the secret it must present.
 * Returns null when unset so we simply omit the block rather than registering
 * an assistant that posts to "undefined".
 */
function serverBlock(): Record<string, unknown> | null {
  const appUrl = process.env.APP_URL ?? "https://app.hiastrix.com"
  const secret = process.env.VAPI_WEBHOOK_SECRET
  if (!secret) return null

  return {
    url: `${appUrl}/api/webhooks/vapi`,
    headers: { "x-vapi-secret": secret },
  }
}

export function buildAssistantPayload(
  core: AgentCore,
  config: AgentConfig
): Record<string, unknown> {
  const v = splitOption(core.voice)
  const m = splitOption(core.model)
  const tools = toolsPayload(config)

  const payload: Record<string, unknown> = {
    name: core.name,
    firstMessage: core.firstMessage,
    firstMessageMode: config.firstMessageMode,
    firstMessageInterruptionsEnabled: config.firstMessageInterruptionsEnabled,

    model: {
      provider: m.provider,
      model: m.id,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      messages: [{ role: "system", content: core.systemPrompt }],
      ...(config.knowledgeBaseId
        ? { knowledgeBaseId: config.knowledgeBaseId }
        : {}),
      // Always sent, including as an empty array. Omitting the key on an update
      // risks the provider deep-merging `model` and keeping a tool the tenant
      // just deleted — an agent that still books appointments after you removed
      // its booking tool is worse than a redundant empty array.
      tools,
    },

    voice: { provider: v.provider, voiceId: v.id },

    maxDurationSeconds:    config.maxDurationSeconds,
    silenceTimeoutSeconds: config.silenceTimeoutSeconds,
    backgroundSound:       config.backgroundSound,

    startSpeakingPlan: {
      waitSeconds: config.startSpeakingWaitSeconds,
      smartEndpointingEnabled: config.smartEndpointingEnabled,
    },
    stopSpeakingPlan: {
      numWords:        config.stopSpeakingNumWords,
      voiceSeconds:    config.stopSpeakingVoiceSeconds,
      backoffSeconds:  config.stopSpeakingBackoffSeconds,
    },

    // Recording and transcript retention are artifact concerns in Vapi.
    artifactPlan: {
      recordingEnabled:  core.recordingEnabled,
      transcriptPlan:    { enabled: core.transcriptionEnabled },
    },

    analysisPlan: {
      ...(config.summaryEnabled ? { summaryPlan: { enabled: true } } : {}),
      ...(config.successEvaluationEnabled
        ? { successEvaluationPlan: { enabled: true } }
        : {}),
      ...(config.structuredDataEnabled && config.structuredDataSchema.trim()
        ? {
            structuredDataPlan: {
              enabled: true,
              schema: JSON.parse(config.structuredDataSchema),
            },
          }
        : {}),
    },


    // Which events reach our webhook. Billing depends on end-of-call-report.
    serverMessages: [
      "status-update",
      "end-of-call-report",
      "transcript",
    ],
  }

  // Transcription off means no transcriber is attached at all.
  //
  // The shape is provider-specific: deepgram takes `model`, assembly-ai
  // rejects it outright ("transcriber.property model should not exist"), and
  // only some accept `language`. transcriberPayload owns those differences.
  if (core.transcriptionEnabled) {
    payload.transcriber = transcriberPayload(config.transcriber, config.language)
  }

  if (config.backgroundDenoisingEnabled) {
    payload.backgroundSpeechDenoisingPlan = { smartDenoisingPlan: { enabled: true } }
  }

  if (config.voicemailDetectionEnabled) {
    payload.voicemailDetection = { provider: "vapi" }
    if (config.voicemailMessage.trim()) {
      payload.voicemailMessage = config.voicemailMessage
    }
  }

  if (config.endCallMessage.trim()) payload.endCallMessage = config.endCallMessage
  if (config.endCallPhrases.length)  payload.endCallPhrases  = config.endCallPhrases

  if (config.keypadInputEnabled) {
    payload.keypadInputPlan = {
      enabled: true,
      timeoutSeconds: config.keypadTimeoutSeconds,
    }
  }

  // Only sent when actually switched on. HIPAA is never sent — it requires a
  // signed BAA and an Enterprise plan, which is a contract decision, not a
  // per-agent toggle.
  if (config.pciEnabled) {
    payload.compliancePlan = { pciEnabled: true }
  }

  const server = serverBlock()
  if (server) payload.server = server

  return payload
}
