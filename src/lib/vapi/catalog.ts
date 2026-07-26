/**
 * Live option catalogue for the agent builder.
 *
 * SERVER ONLY — talks to Vapi with the private key.
 *
 * Hardcoding these lists was a mistake: eight of the eleven voices I first
 * shipped had been retired, and every save against one failed with a 400. So
 * the voice list is now fetched from the account itself and cached, with the
 * documented set as a fallback for when the endpoint is unavailable.
 *
 * Cached in module scope with a TTL. A serverless instance holds it for its
 * lifetime, so the builder costs at most one upstream call per instance per
 * hour rather than one per page view.
 */

import type { Option } from "./options"

const TTL_MS = 60 * 60 * 1000

type Cache<T> = { value: T; at: number } | null
let voiceCache: Cache<Option[]> = null

const VAPI_BASE_URL = "https://api.vapi.ai"

/**
 * Voices documented as current for the `vapi` provider. Used when the live
 * lookup is unavailable. Deliberately excludes the retired set — Spencer,
 * Neha, Harry, Cole, Paige, Hana, Lily and Kylie — which the API now rejects.
 */
const FALLBACK_VOICES: Option[] = [
  { value: "vapi:Elliot",   label: "Elliot",   note: "Male, neutral American" },
  { value: "vapi:Savannah", label: "Savannah", note: "Female, Southern US" },
  { value: "vapi:Rohan",    label: "Rohan",    note: "Male, Indian English" },
  { value: "vapi:Emma",     label: "Emma",     note: "Female, warm" },
  { value: "vapi:Clara",    label: "Clara",    note: "Female, clear" },
  { value: "vapi:Nico",     label: "Nico",     note: "Male, friendly" },
  { value: "vapi:Kai",      label: "Kai",      note: "Male, relaxed" },
  { value: "vapi:Sagar",    label: "Sagar",    note: "Male, Indian English" },
  { value: "vapi:Godfrey",  label: "Godfrey",  note: "Male, mature" },
  { value: "vapi:Neil",     label: "Neil",     note: "Male, British" },
  { value: "vapi:Layla",    label: "Layla",    note: "Female, expressive" },
  { value: "vapi:Sid",      label: "Sid",      note: "Male, energetic" },
  { value: "vapi:Naina",    label: "Naina",    note: "Female, Indian English" },
]

type LibraryVoice = {
  voiceId?: string
  slug?: string
  name?: string
  provider?: string
  gender?: string
  accent?: string
  description?: string
  isDeprecated?: boolean
  isPublic?: boolean
}

/**
 * Ask the account which voices it can actually use.
 *
 * Any failure — endpoint absent, key unset, network — falls back silently.
 * A builder that opens with a slightly stale list is far better than one that
 * fails to open at all.
 */
async function fetchVoices(): Promise<Option[]> {
  const key = process.env.VAPI_API_KEY
  if (!key) return FALLBACK_VOICES

  try {
    const res = await fetch(`${VAPI_BASE_URL}/voice-library?provider=vapi`, {
      headers: { Authorization: `Bearer ${key}` },
      // Never let a slow catalogue lookup hold up the page.
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return FALLBACK_VOICES

    const body = (await res.json()) as LibraryVoice[] | { results?: LibraryVoice[] }
    const list = Array.isArray(body) ? body : (body.results ?? [])
    if (!Array.isArray(list) || list.length === 0) return FALLBACK_VOICES

    const options: Option[] = []
    for (const v of list) {
      if (v.isDeprecated) continue
      const id = v.voiceId ?? v.slug ?? v.name
      if (!id) continue

      const note = [v.gender, v.accent].filter(Boolean).join(", ")
      options.push({
        value: `vapi:${id}`,
        label: v.name ?? id,
        ...(note ? { note } : {}),
      })
    }

    return options.length ? options : FALLBACK_VOICES
  } catch {
    return FALLBACK_VOICES
  }
}

export async function getVoiceOptions(): Promise<Option[]> {
  if (voiceCache && Date.now() - voiceCache.at < TTL_MS) return voiceCache.value

  const value = await fetchVoices()
  voiceCache = { value, at: Date.now() }
  return value
}

/**
 * Language models.
 *
 * Vapi publishes no list endpoint for these, so the curated set below is the
 * honest option — but the builder also accepts a free-text "provider:model"
 * so a new release never blocks anyone waiting on a deploy from us.
 */
export const MODEL_OPTIONS: Option[] = [
  { value: "openai:gpt-4o",             label: "GPT-4o",            note: "Balanced quality and speed" },
  { value: "openai:gpt-4o-mini",        label: "GPT-4o mini",       note: "Fastest, lowest cost" },
  { value: "openai:gpt-4.1",            label: "GPT-4.1",           note: "Strong reasoning" },
  { value: "openai:gpt-4.1-mini",       label: "GPT-4.1 mini",      note: "Fast, cheaper" },
  { value: "anthropic:claude-sonnet-4-20250514", label: "Claude Sonnet 4", note: "Excellent instruction following" },
  { value: "anthropic:claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", note: "Very fast" },
  { value: "google:gemini-2.0-flash",   label: "Gemini 2.0 Flash",  note: "Low latency" },
  { value: "groq:llama-3.3-70b-versatile", label: "Llama 3.3 70B",  note: "Lowest latency" },
]

/**
 * Transcribers.
 *
 * `payload` is stored per option rather than parsed out of the value string,
 * because providers disagree about which properties they accept — sending
 * `model` to assembly-ai is rejected outright. Keeping the exact shape here
 * means the payload builder never has to guess.
 */
export type TranscriberOption = Option & {
  payload: Record<string, unknown>
  /** Whether this provider accepts a language property. */
  acceptsLanguage: boolean
}

export const TRANSCRIBER_OPTIONS: TranscriberOption[] = [
  {
    value: "deepgram:nova-3",
    label: "Deepgram Nova 3",
    note: "Newest, most accurate",
    payload: { provider: "deepgram", model: "nova-3" },
    acceptsLanguage: true,
  },
  {
    value: "deepgram:nova-2",
    label: "Deepgram Nova 2",
    note: "Fast and reliable",
    payload: { provider: "deepgram", model: "nova-2" },
    acceptsLanguage: true,
  },
  {
    value: "assembly-ai",
    label: "AssemblyAI",
    note: "Strong on accents — English only",
    payload: { provider: "assembly-ai" },
    acceptsLanguage: false,
  },
  {
    value: "openai:gpt-4o-transcribe",
    label: "OpenAI Transcribe",
    note: "Robust in noisy audio",
    payload: { provider: "openai", model: "gpt-4o-transcribe" },
    acceptsLanguage: true,
  },
]

export function transcriberPayload(value: string, language: string) {
  const opt =
    TRANSCRIBER_OPTIONS.find(t => t.value === value) ?? TRANSCRIBER_OPTIONS[1]

  return opt.acceptsLanguage && language
    ? { ...opt.payload, language }
    : { ...opt.payload }
}
