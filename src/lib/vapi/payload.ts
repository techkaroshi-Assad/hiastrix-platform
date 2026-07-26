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
import type { AgentConfig } from "./config"

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
  const t = splitOption(config.transcriber)

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
      ...(config.toolsJson.trim()
        ? { tools: JSON.parse(config.toolsJson) }
        : {}),
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
  if (core.transcriptionEnabled) {
    payload.transcriber = {
      provider: t.provider,
      model: t.id,
      language: config.language,
    }
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
