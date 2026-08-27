/**
 * Vapi Server-Side API Client
 * All calls go through our backend — the Vapi API key is NEVER exposed to the browser.
 */

const VAPI_BASE_URL = "https://api.vapi.ai"

/**
 * Every request is bounded.
 *
 * Without this a hung provider request waits forever. Inside a page request
 * that is merely slow — the platform eventually kills the function. Inside the
 * dialer's tick loop it is fatal: one hung POST consumes the whole tick, the
 * leads it claimed sit unreachable until their lease expires, and the campaign
 * stalls for a minute at a time.
 */
const DEFAULT_TIMEOUT_MS = 20_000

/** Thrown for 404 specifically, so callers can tell "gone" from "broken". */
export class VapiNotFound extends Error {
  constructor(path: string) {
    super(`Vapi API error 404: ${path}`)
    this.name = "VapiNotFound"
  }
}

async function vapiRequest<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options

  // A caller-supplied signal wins; otherwise every request gets the default
  // deadline. AbortSignal.any means a caller's cancellation and the timeout
  // both work, rather than one replacing the other.
  const deadline = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

  let res: Response
  try {
    res = await fetch(`${VAPI_BASE_URL}${path}`, {
      ...init,
      signal: combined,
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    })
  } catch (err) {
    // Keep the "Vapi API error <n>" shape so sanitiseError keeps working, and
    // so a timeout is distinguishable from a rejection in the logs.
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`Vapi API error 408: request timed out after ${timeoutMs}ms`)
    }
    throw err
  }

  if (res.status === 404) throw new VapiNotFound(path)

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Vapi API error ${res.status}: ${error}`)
  }

  // DELETE and some PATCH responses have no body.
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

// ─── Assistants ──────────────────────────────────────────────────────────────

export const vapiAssistants = {
  create: (data: Record<string, unknown>) =>
    vapiRequest("/assistant", { method: "POST", body: JSON.stringify(data) }),

  get: (id: string) => vapiRequest(`/assistant/${id}`),

  update: (id: string, data: Record<string, unknown>) =>
    vapiRequest(`/assistant/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: string) =>
    vapiRequest(`/assistant/${id}`, { method: "DELETE" }),

  /*
   * There is deliberately no enable/disable here.
   *
   * An assistant has no on/off switch — no isActive, no status, no enabled.
   * This module used to PATCH `isActive`, which the provider rejected outright
   * ("property isActive should not exist"), so every toggle failed and the
   * billing rule that pauses agents at zero credit never actually paused
   * anything.
   *
   * Availability is a property of the phone number pointing at the assistant.
   * See lib/agents/availability.ts.
   */
}

// ─── Phone Numbers ────────────────────────────────────────────────────────────

export const vapiPhoneNumbers = {
  list: () => vapiRequest("/phone-number"),

  get: (id: string) => vapiRequest(`/phone-number/${id}`),

  assignAssistant: (phoneNumberId: string, assistantId: string | null) =>
    vapiRequest(`/phone-number/${phoneNumberId}`, {
      method: "PATCH",
      body: JSON.stringify({ assistantId }),
    }),
}

// ─── Files ────────────────────────────────────────────────────────────────────

export const vapiFiles = {
  /**
   * Upload one file, multipart.
   *
   * Deliberately not built on `vapiRequest`: that helper always sends
   * `Content-Type: application/json`, which is exactly wrong here — a
   * multipart body needs fetch to set its own boundary, and forcing JSON
   * would have the provider try to parse a file as one. Kept small and
   * separate rather than teaching the shared helper an exception.
   */
  async upload(
    content: Buffer,
    filename: string,
    mimeType: string,
    opts: { timeoutMs?: number } = {}
  ): Promise<{ id: string; name?: string }> {
    const form = new FormData()
    form.append("file", new Blob([new Uint8Array(content)], { type: mimeType }), filename)

    let res: Response
    try {
      res = await fetch(`${VAPI_BASE_URL}/file`, {
        method: "POST",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
        body: form,
      })
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(`Vapi API error 408: file upload timed out`)
      }
      throw err
    }

    if (!res.ok) throw new Error(`Vapi API error ${res.status}: ${await res.text()}`)
    return res.json()
  },

  delete: (id: string) => vapiRequest(`/file/${id}`, { method: "DELETE" }),
}

// ─── Tools (knowledge / query) ─────────────────────────────────────────────────

export const vapiTools = {
  /**
   * A "query" tool wraps one or more file-backed knowledge bases and is what
   * an assistant's `model.toolIds` actually references — see
   * lib/vapi/knowledge.ts for why this is recreated rather than edited in
   * place whenever the file list changes.
   */
  createQuery: (data: { name: string; description: string; fileIds: string[] }) =>
    vapiRequest<{ id: string }>("/tool", {
      method: "POST",
      body: JSON.stringify({
        type: "query",
        function: { name: "knowledge_search" },
        knowledgeBases: [
          { provider: "google", name: data.name, description: data.description, fileIds: data.fileIds },
        ],
      }),
    }),

  delete: (id: string) => vapiRequest(`/tool/${id}`, { method: "DELETE" }),
}

// ─── Calls ───────────────────────────────────────────────────────────────────

/** What we get back from placing a call. Only `id` is relied on. */
export type VapiCallCreated = {
  id: string
  status?: string
}

/**
 * A call as read back from the provider.
 *
 * This is the reaper's tiebreaker: when a lease expires we do not know whether
 * the call is dead or merely slow to report, and this is what tells us.
 */
export type VapiCallRead = {
  id: string
  status?: "queued" | "ringing" | "in-progress" | "forwarding" | "ended"
  endedReason?: string
  startedAt?: string
  endedAt?: string
  customer?: { number?: string }
  metadata?: Record<string, string>
}

export const vapiCalls = {
  list: (params: Record<string, string> = {}, opts: { signal?: AbortSignal } = {}) => {
    const query = new URLSearchParams(params).toString()
    return vapiRequest<VapiCallRead[]>(`/call${query ? `?${query}` : ""}`, opts)
  },

  /** Throws VapiNotFound when the call does not exist — which is information. */
  get: (id: string, opts: { signal?: AbortSignal } = {}) =>
    vapiRequest<VapiCallRead>(`/call/${id}`, opts),

  /**
   * Place an outbound call. Requires a number allocated to the tenant, since
   * that is the caller ID the recipient sees.
   *
   * `metadata` is how a dial is correlated back to the queue row that made it.
   * The provider echoes it on every server message for the call, so a webhook
   * can attribute a call even when the create response never reached us.
   */
  create: (
    data: {
      assistantId: string
      phoneNumberId: string
      customer: { number: string }
      metadata?: Record<string, string>
      assistantOverrides?: Record<string, unknown>
    },
    opts: { signal?: AbortSignal; timeoutMs?: number } = {}
  ) =>
    vapiRequest<VapiCallCreated>("/call", {
      ...opts,
      method: "POST",
      body: JSON.stringify(data),
    }),
}
