/**
 * Curated voice and model choices offered in the agent builder.
 *
 * Stored in our database as opaque "provider:id" strings and expanded into
 * Vapi's nested payload server-side (see config.ts). Keeping the DB value flat
 * means adding a provider later needs no migration.
 *
 * These lists are presentation choices, not a contract with Vapi — edit freely.
 */

export type Option = { value: string; label: string; note?: string }

/** Vapi's own voice provider — no third-party voice key required. */
export const VOICES: Option[] = [
  { value: "vapi:Elliot",   label: "Elliot",   note: "Warm male, neutral American" },
  { value: "vapi:Kylie",    label: "Kylie",    note: "Bright female, American" },
  { value: "vapi:Rohan",    label: "Rohan",    note: "Male, Indian English" },
  { value: "vapi:Lily",     label: "Lily",     note: "Soft female, British" },
  { value: "vapi:Savannah", label: "Savannah", note: "Female, Southern US" },
  { value: "vapi:Hana",     label: "Hana",     note: "Calm female, neutral" },
  { value: "vapi:Neha",     label: "Neha",     note: "Female, Indian English" },
  { value: "vapi:Cole",     label: "Cole",     note: "Male, confident" },
  { value: "vapi:Harry",    label: "Harry",    note: "Male, British" },
  { value: "vapi:Paige",    label: "Paige",    note: "Female, professional" },
  { value: "vapi:Spencer",  label: "Spencer",  note: "Male, relaxed" },
]

export const MODELS: Option[] = [
  { value: "openai:gpt-4o",             label: "GPT-4o",            note: "Best all-round quality" },
  { value: "openai:gpt-4o-mini",        label: "GPT-4o mini",       note: "Fastest, lowest cost" },
  { value: "anthropic:claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", note: "Strong instruction following" },
  { value: "anthropic:claude-3-5-haiku-20241022",  label: "Claude 3.5 Haiku",  note: "Fast and inexpensive" },
  { value: "google:gemini-2.0-flash",   label: "Gemini 2.0 Flash",  note: "Very low latency" },
]

export const DEFAULT_VOICE = VOICES[0].value
export const DEFAULT_MODEL = MODELS[1].value

export function splitOption(value: string): { provider: string; id: string } {
  const idx = value.indexOf(":")
  if (idx === -1) return { provider: "vapi", id: value }
  return { provider: value.slice(0, idx), id: value.slice(idx + 1) }
}

export function labelFor(list: readonly Option[], value: string | null | undefined) {
  if (!value) return "—"
  return list.find(o => o.value === value)?.label ?? value
}
