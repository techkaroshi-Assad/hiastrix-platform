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
 * The voice provider publishes no list endpoint for these, so the curated set
 * below is the honest starting point — these are the handful actually worth
 * putting behind a phone call, and each one is named with why.
 *
 * Everything else arrives from OpenRouter. Once an OpenRouter key is attached
 * to the provider account, every model on their catalogue becomes reachable, so
 * hard-coding eight of them would be pretending the choice is smaller than it
 * is. Their model list is public and needs no key to read, which is what makes
 * this the same "ask, don't hardcode" arrangement the voice list already uses.
 */
export const CORE_MODEL_OPTIONS: Option[] = [
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
 * Kept for the modules that only ever wanted a default.
 *
 * The full list is now asynchronous, and a page that just needs something
 * sensible to preselect should not have to wait on a network call to get it.
 */
export const MODEL_OPTIONS = CORE_MODEL_OPTIONS

type OpenRouterModel = {
  id?: string
  name?: string
  context_length?: number
  architecture?: { modality?: string; input_modalities?: string[] }
  pricing?: { prompt?: string; completion?: string }
}

let modelCache: { value: Option[]; at: number } | null = null

/**
 * Everything OpenRouter can serve, as provider-prefixed options.
 *
 * Two filters, and both earn their place. A model that cannot take text in is
 * no use to a voice agent, and a model with no id cannot be sent anywhere. What
 * is deliberately *not* filtered is speed or price: a slow model on a phone
 * call is a bad experience rather than a broken one, and that is the tenant's
 * call to make, not ours to prevent.
 */
async function fetchOpenRouterModels(): Promise<Option[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      // Their catalogue changes daily, not hourly.
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []

    const body = await res.json() as { data?: OpenRouterModel[] }
    const rows = Array.isArray(body.data) ? body.data : []

    const options: Option[] = []
    for (const m of rows) {
      if (!m.id) continue

      const modalities = m.architecture?.input_modalities
      if (Array.isArray(modalities) && !modalities.includes("text")) continue

      const context = m.context_length
        ? `${Math.round(m.context_length / 1000)}k context`
        : ""
      const free = m.pricing?.prompt === "0" ? "free" : ""
      const note = [context, free].filter(Boolean).join(" · ")

      options.push({
        value: `openrouter:${m.id}`,
        label: m.name ?? m.id,
        ...(note ? { note } : {}),
      })
    }

    return options.sort((a, b) => a.label.localeCompare(b.label))
  } catch {
    // A catalogue we could not read is not a reason to stop anyone editing an
    // agent — they still have the curated list.
    return []
  }
}

/**
 * The curated models first, then everything OpenRouter offers.
 *
 * Order is the recommendation: the eight at the top are the ones proven on a
 * phone call, and the hundreds below are there because the account can reach
 * them, not because they are all a good idea. The builder makes that ordering
 * visible rather than burying the sensible choices alphabetically among three
 * hundred others.
 */
export async function getModelOptions(): Promise<Option[]> {
  if (modelCache && Date.now() - modelCache.at < TTL_MS) return modelCache.value

  const extra = await fetchOpenRouterModels()
  const value = [...CORE_MODEL_OPTIONS, ...extra]

  modelCache = { value, at: Date.now() }
  return value
}

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
