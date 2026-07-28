/**
 * Vapi Server-Side API Client
 * All calls go through our backend — the Vapi API key is NEVER exposed to the browser.
 */

const VAPI_BASE_URL = "https://api.vapi.ai"

async function vapiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${VAPI_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

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

// ─── Calls ───────────────────────────────────────────────────────────────────

export const vapiCalls = {
  list: (params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params).toString()
    return vapiRequest(`/call${query ? `?${query}` : ""}`)
  },

  get: (id: string) => vapiRequest(`/call/${id}`),

  /**
   * Place an outbound call. Requires a number allocated to the tenant, since
   * that is the caller ID the recipient sees.
   */
  create: (data: {
    assistantId: string
    phoneNumberId: string
    customer: { number: string }
  }) => vapiRequest("/call", { method: "POST", body: JSON.stringify(data) }),
}
