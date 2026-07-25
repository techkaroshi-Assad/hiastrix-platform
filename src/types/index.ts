// ─── User Session Types ───────────────────────────────────────────────────────

export type UserRole = "super_admin" | "admin" | "account_manager" | "tenant_owner"

export interface SessionUser {
  id: string           // Supabase auth.users id
  email: string
  name: string
  role: UserRole
  tenantId?: string    // set for account_manager and tenant_owner
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data?: T
  error?: string
}

// ─── Vapi Webhook Payloads ────────────────────────────────────────────────────

export interface VapiWebhookPayload {
  type: "call.started" | "call.ended" | "recording.ready" | "transcript.ready"
  call: {
    id: string
    assistantId: string
    phoneNumberId?: string
    type: "inboundPhoneCall" | "outboundPhoneCall" | "webCall"
    startedAt?: string
    endedAt?: string
    duration?: number         // seconds
    recordingUrl?: string
    transcript?: string
    status?: string
    customer?: {
      number?: string
    }
  }
}

// ─── Stripe Webhook Payloads ──────────────────────────────────────────────────

export interface StripeWebhookPayload {
  type: "payment_intent.succeeded" | "payment_intent.payment_failed"
  data: {
    object: {
      id: string
      amount: number          // USD cents
      metadata: {
        tenantId: string
        type: "package_purchase" | "top_up"
      }
    }
  }
}
