/**
 * Full Vapi assistant configuration.
 *
 * Our database keeps the fields we query and display as real columns (name,
 * voice, model, prompts, recording, transcription) and everything else in
 * `agents.config` as JSON. This module owns three things:
 *
 *   1. the shape and validation of that JSON        (AgentConfigSchema)
 *   2. sensible defaults for a new agent            (DEFAULT_CONFIG)
 *
 * Translation into Vapi's payload lives in ./payload.ts, which is server-only
 * (it reads the webhook secret). This file is safe to import from client
 * components — it holds nothing but option lists, the schema and defaults.
 */

import { z } from "zod"
import { AgentToolSchema, toolIssues, normaliseTools, type AgentTool } from "./tools"

export type { AgentTool }

/* ── Option lists for the builder UI ──────────────────────────────────── */

export const FIRST_MESSAGE_MODES = [
  { value: "assistant-speaks-first", label: "Agent speaks first", note: "Plays your first message" },
  { value: "assistant-speaks-first-with-model-generated-message", label: "Agent opens, improvised", note: "Model writes the greeting" },
  { value: "assistant-waits-for-user", label: "Wait for the caller", note: "Silent until they speak" },
] as const

export const BACKGROUND_SOUNDS = [
  { value: "off",    label: "None" },
  { value: "office", label: "Office ambience" },
] as const

export const TRANSCRIBER_PROVIDERS = [
  { value: "deepgram:nova-2",         label: "Deepgram Nova 2",       note: "Fast, accurate, default" },
  { value: "deepgram:nova-3",         label: "Deepgram Nova 3",       note: "Newest Deepgram model" },
  { value: "assembly-ai:best",        label: "AssemblyAI Best",       note: "Strong on accents" },
  { value: "openai:gpt-4o-transcribe", label: "OpenAI Transcribe",    note: "Robust in noise" },
] as const

export const LANGUAGES = [
  { value: "en",    label: "English" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IN", label: "English (India)" },
  { value: "es",    label: "Spanish" },
  { value: "fr",    label: "French" },
  { value: "de",    label: "German" },
  { value: "hi",    label: "Hindi" },
  { value: "ar",    label: "Arabic" },
  { value: "pt",    label: "Portuguese" },
  { value: "multi", label: "Auto-detect" },
] as const

/* ── Config schema ────────────────────────────────────────────────────── */

/**
 * Tools are provider-shaped and evolve quickly, so they are accepted as raw
 * JSON and validated only for being a well-formed array. Vapi rejects a bad
 * tool definition itself, and that error is sanitised before it reaches the UI.
 */
const ToolsJsonSchema = z
  .string()
  .max(20000)
  .refine(
    s => {
      if (!s.trim()) return true
      try {
        return Array.isArray(JSON.parse(s))
      } catch {
        return false
      }
    },
    { message: "Tools must be a JSON array." }
  )

const StructuredSchemaJson = z
  .string()
  .max(20000)
  .refine(
    s => {
      if (!s.trim()) return true
      try {
        const parsed = JSON.parse(s)
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      } catch {
        return false
      }
    },
    { message: "Schema must be a JSON object." }
  )

export const AgentConfigSchema = z.object({
  /* Conversation opening */
  firstMessageMode: z
    .enum([
      "assistant-speaks-first",
      "assistant-speaks-first-with-model-generated-message",
      "assistant-waits-for-user",
    ])
    .default("assistant-speaks-first"),
  firstMessageInterruptionsEnabled: z.boolean().default(false),

  /* Model tuning */
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens:   z.number().int().min(50).max(4000).default(250),
  knowledgeBaseId: z.string().max(120).default(""),

  /* Transcription */
  transcriber: z.string().default("deepgram:nova-2"),
  language:    z.string().default("en"),

  /* Call control */
  maxDurationSeconds:   z.number().int().min(30).max(43200).default(600),
  silenceTimeoutSeconds: z.number().int().min(10).max(3600).default(30),
  endCallMessage: z.string().max(1000).default(""),
  endCallPhrases: z.array(z.string().min(1).max(120)).max(20).default([]),
  backgroundSound: z.enum(["off", "office"]).default("off"),
  backgroundDenoisingEnabled: z.boolean().default(false),

  /* Voicemail */
  voicemailDetectionEnabled: z.boolean().default(false),
  voicemailMessage: z.string().max(1000).default(""),

  /* Analysis */
  summaryEnabled: z.boolean().default(true),
  successEvaluationEnabled: z.boolean().default(false),
  structuredDataEnabled: z.boolean().default(false),
  structuredDataSchema: StructuredSchemaJson.default(""),

  /* Latency and interruption tuning */
  startSpeakingWaitSeconds: z.number().min(0).max(5).default(0.4),
  smartEndpointingEnabled:  z.boolean().default(true),
  stopSpeakingNumWords:     z.number().int().min(0).max(20).default(0),
  stopSpeakingVoiceSeconds: z.number().min(0).max(5).default(0.2),
  stopSpeakingBackoffSeconds: z.number().min(0).max(10).default(1),

  /* Keypad (DTMF) */
  keypadInputEnabled:  z.boolean().default(false),
  keypadTimeoutSeconds: z.number().int().min(1).max(30).default(2),

  /**
   * Compliance
   *
   * HIPAA is deliberately absent. Vapi gates it behind an Enterprise plan or a
   * paid add-on *and* a signed BAA, so offering the switch to tenants would
   * only produce failures. Add it back alongside the contract, not before.
   *
   * PCI is available on standard accounts, but it is destructive without
   * PCI-compliant external storage: recordings and transcripts are deleted
   * rather than retained, and platform access to call artefacts is restricted.
   * The UI says so at the point of use.
   */
  pciEnabled: z.boolean().default(false),

  /* Tools */
  tools: z.array(AgentToolSchema).max(20).default([]),

  /**
   * DEPRECATED — raw tool JSON from before the structured builder existed.
   *
   * Still read and still emitted into the payload verbatim. Removing this key
   * would silently strip working tools from any agent that predates the
   * builder, on its very next save. New agents never see it; the UI only
   * surfaces it when it is already non-empty.
   */
  toolsJson: ToolsJsonSchema.default(""),
})

export type AgentConfig = z.infer<typeof AgentConfigSchema>

export const DEFAULT_CONFIG: AgentConfig = AgentConfigSchema.parse({})

/**
 * Cross-field validation lives outside the base object, deliberately.
 *
 *   AgentConfigSchema      — field-level only, a plain object schema.
 *                            `readConfig` uses it, so a stored row that trips a
 *                            cross-tool rule is never silently replaced
 *                            wholesale by DEFAULT_CONFIG. `.partial()` also
 *                            stays available, which a refinement would remove.
 *
 *   AgentConfigInputSchema — what every write path validates against.
 */
export const AgentConfigInputSchema = AgentConfigSchema.superRefine((cfg, ctx) => {
  for (const issue of toolIssues(cfg.tools)) {
    ctx.addIssue({
      code: "custom",
      path: ["tools", ...issue.path],
      message: issue.message,
    })
  }
})

/** Partial patch — keeps "omitted" distinct from "explicitly default". */
export const ConfigPatchSchema = AgentConfigSchema.partial()

/**
 * Parse whatever is in the DB column.
 *
 * Tools are normalised *before* the object is parsed, and that ordering is the
 * whole point. A stored tool whose type we no longer recognise would otherwise
 * fail the parse and send the entire config back to defaults — resetting the
 * prompt, temperature, transcriber and twenty other unrelated fields on the next
 * render, and persisting that loss on the next save. `normaliseTools` translates
 * what it can and drops only the entry that is actually stale.
 */
export function readConfig(raw: unknown): AgentConfig {
  const source: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {}

  if ("tools" in source) source.tools = normaliseTools(source.tools)

  const parsed = AgentConfigSchema.safeParse(source)
  return parsed.success ? parsed.data : DEFAULT_CONFIG
}
