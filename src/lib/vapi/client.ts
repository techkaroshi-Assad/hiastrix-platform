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

  return res.json()
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

  disable: (id: string) =>
    vapiRequest(`/assistant/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    }),

  enable: (id: string) =>
    vapiRequest(`/assistant/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: true }),
    }),
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

  startWebCall: (data: { assistantId: string }) =>
    vapiRequest("/call/web", { method: "POST", body: JSON.stringify(data) }),
}
