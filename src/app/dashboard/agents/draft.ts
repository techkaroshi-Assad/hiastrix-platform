/**
 * The shape of an agent being edited, and a blank one.
 *
 * No `"use client"`. `blankDraft` is called by the server page that renders the
 * new-agent form, and a function exported from a client module cannot be called
 * from a server component — it typechecks, builds, and then throws at request
 * time with "Attempted to call blankDraft() from the server". The same trap that
 * took the campaigns page down; the scanner caught this one before it shipped.
 */

import { DEFAULT_CONFIG, type AgentConfig } from "@/lib/vapi/config"
import type { Option } from "@/lib/vapi/options"

export type Draft = {
  name: string
  systemPrompt: string
  firstMessage: string
  voice: string
  model: string
  recordingEnabled: boolean
  transcriptionEnabled: boolean
  config: AgentConfig
}

export function blankDraft(voices: Option[], models: Option[]): Draft {
  return {
    name: "",
    // Deliberately empty. A plausible-looking default prompt is worse than
    // none: people leave it, and "You are a helpful assistant" produces an
    // agent that is helpful about nothing in particular. The template picker
    // is the answer to a blank box.
    systemPrompt: "",
    firstMessage: "",
    // From the live catalogue, because the provider retires voices and a
    // withdrawn one pre-selected here fails at save with an opaque error.
    voice: voices[0]?.value ?? "",
    model: models.find(m => m.value.endsWith("mini"))?.value ?? models[0]?.value ?? "",
    recordingEnabled: true,
    transcriptionEnabled: true,
    config: DEFAULT_CONFIG,
  }
}
