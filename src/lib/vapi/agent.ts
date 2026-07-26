/**
 * Whole-agent schemas.
 *
 * Client-safe. These replace the hand-duplicated bodies that lived in the two
 * agent routes: once a JSON editor exists there would have been three copies of
 * the same shape, and the copy that drifted would be the one that rejected a
 * valid save.
 */

import { z } from "zod"
import {
  AgentConfigSchema,
  AgentConfigInputSchema,
  ConfigPatchSchema,
} from "./config"
import { toolIssues } from "./tools"

/** The fields stored as real columns rather than inside `config`. */
export const AgentCoreSchema = z.object({
  name:                 z.string().min(2).max(60),
  systemPrompt:         z.string().min(10).max(8000),
  firstMessage:         z.string().min(1).max(1000),
  voice:                z.string().min(1),
  model:                z.string().min(1),
  recordingEnabled:     z.boolean(),
  transcriptionEnabled: z.boolean(),
})

export type AgentCoreInput = z.infer<typeof AgentCoreSchema>

/** POST /api/agents body. */
export const AgentDraftSchema = AgentCoreSchema.extend({
  config: AgentConfigInputSchema.optional(),
})

/** PATCH /api/agents/[id] body — everything optional, config merged not replaced. */
export const AgentPatchSchema = AgentCoreSchema.partial().extend({
  config: ConfigPatchSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
})

/**
 * What the JSON editor edits.
 *
 * `.strict()` on both levels so an unrecognised key is a visible error rather
 * than a silent drop — zod strips unknown keys by default, which inside a text
 * editor reads as "the app ate my line".
 *
 * Server-owned fields (server, serverMessages, vapiAssistantId, tenantId,
 * status) are absent from this shape on purpose. Pasting one in is a clear
 * error, which is exactly what we want: the tenant cannot unhook their own
 * billing webhook by editing JSON.
 */
export const AgentJsonSchema = AgentCoreSchema.extend({
  config: AgentConfigSchema.strict(),
})
  .strict()
  .superRefine((draft, ctx) => {
    for (const issue of toolIssues(draft.config.tools)) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "tools", ...issue.path],
        message: issue.message,
      })
    }
  })

export type AgentJson = z.infer<typeof AgentJsonSchema>

/** First problem, rendered as "path — message" for a single-line error slot. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "That doesn't look valid."
  const path = issue.path.join(".")
  return path ? `${path} — ${issue.message}` : issue.message
}
