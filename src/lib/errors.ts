/**
 * Error Sanitisation Layer
 *
 * ALL errors from external vendors (Supabase, Stripe, Vapi, Resend, Prisma)
 * are caught here and mapped to generic, user-friendly messages.
 *
 * No vendor names, internal codes, URLs, or stack traces ever reach
 * the tenant-facing UI. If in doubt, return the FALLBACK message.
 */

export const ERRORS = {
  // ── Auth ───────────────────────────────────────────────────────────────
  INVALID_CREDENTIALS:    "The email or password you entered is incorrect.",
  EMAIL_NOT_VERIFIED:     "Please verify your email address before signing in.",
  EMAIL_ALREADY_EXISTS:   "An account with this email already exists.",
  ACCOUNT_PENDING:        "Your account is pending activation. We'll be in touch shortly.",
  ACCOUNT_BLOCKED:        "Your account has been suspended. Please contact support.",
  WEAK_PASSWORD:          "Your password must be at least 8 characters long.",
  RESET_EMAIL_SENT:       "If that email is registered, you'll receive a reset link shortly.",
  PASSWORD_UPDATED:       "Your password has been updated successfully.",
  SESSION_EXPIRED:        "Your session has expired. Please sign in again.",
  UNAUTHORIZED:           "You don't have permission to do that.",

  // ── Billing ────────────────────────────────────────────────────────────
  PAYMENT_FAILED:         "Your payment could not be processed. Please check your card details.",
  PAYMENT_REQUIRED:       "Please top up your balance to continue making calls.",
  BALANCE_LOW:            "Your balance is running low. Top up to avoid interruption.",

  // ── Agents ────────────────────────────────────────────────────────────
  AGENT_CREATE_FAILED:    "We couldn't create the agent. Please try again.",
  AGENT_UPDATE_FAILED:    "We couldn't save your changes. Please try again.",
  AGENT_DELETE_FAILED:    "We couldn't delete this agent. Please try again.",

  // ── General ───────────────────────────────────────────────────────────
  NOT_FOUND:              "That resource could not be found.",
  FALLBACK:               "Something went wrong. Please try again or contact support.",
} as const

export type AppError = (typeof ERRORS)[keyof typeof ERRORS]

/**
 * Maps a raw vendor error to a safe user-facing message.
 * Logs the original error server-side for debugging.
 */
/**
 * Voice/telephony provider validation failures.
 *
 * These are the user's own configuration being rejected — a retired voice, a
 * property the chosen transcriber doesn't accept. Collapsing them into
 * "Something went wrong" forces someone to read server logs to discover a
 * fixable mistake, which is exactly what happened in practice.
 *
 * So we surface the meaning while stripping the vendor's name, URLs and
 * internal field paths. The tenant learns what to change, never who we use.
 */
function providerRejection(raw: string): string | null {
  const m = raw.toLowerCase()

  if (!m.includes("400") && !m.includes("bad request")) return null

  if (m.includes("legacy voice") || m.includes("phased out") || m.includes("retired")) {
    return "That voice is no longer available. Please choose a different one and save again."
  }
  if (m.includes("voice")) {
    return "That voice isn't available for this agent. Please choose a different one."
  }
  if (m.includes("transcriber")) {
    return "That transcription option isn't compatible with the rest of this agent's setup. Try a different engine or language."
  }
  if (m.includes("tool") || m.includes("function")) {
    return "One of this agent's tools was rejected. Check that the JSON is a valid tool definition."
  }
  if (m.includes("knowledgebase") || m.includes("knowledge base")) {
    return "That knowledge base ID wasn't recognised. Check it and try again."
  }
  if (m.includes("model")) {
    return "That language model isn't available. Please choose a different one."
  }

  return "Some of this agent's settings were rejected. Please review them and try again."
}

export function sanitiseError(error: unknown, context?: string): string {
  // Always log the real error server-side (never sent to client)
  console.error(`[${context ?? "error"}]`, error)

  if (!(error instanceof Error)) return ERRORS.FALLBACK

  // Configuration rejections are the user's to fix, so say what's wrong.
  if (context?.includes("provider")) {
    const friendly = providerRejection(error.message)
    if (friendly) return friendly
  }

  const msg = error.message.toLowerCase()

  // ── Supabase Auth error mapping ────────────────────────────────────────
  if (msg.includes("invalid login credentials") || msg.includes("invalid password")) {
    return ERRORS.INVALID_CREDENTIALS
  }
  if (msg.includes("email not confirmed")) {
    return ERRORS.EMAIL_NOT_VERIFIED
  }
  if (msg.includes("user already registered") || msg.includes("already been registered")) {
    return ERRORS.EMAIL_ALREADY_EXISTS
  }
  if (msg.includes("password should be at least")) {
    return ERRORS.WEAK_PASSWORD
  }
  if (msg.includes("jwt expired") || msg.includes("session_not_found")) {
    return ERRORS.SESSION_EXPIRED
  }

  // ── Stripe error mapping ───────────────────────────────────────────────
  if (msg.includes("card_declined") || msg.includes("insufficient_funds")) {
    return ERRORS.PAYMENT_FAILED
  }

  // ── Prisma / DB error mapping ──────────────────────────────────────────
  if (msg.includes("unique constraint") || msg.includes("p2002")) {
    return ERRORS.EMAIL_ALREADY_EXISTS
  }
  if (msg.includes("record to update not found") || msg.includes("p2025")) {
    return ERRORS.NOT_FOUND
  }

  return ERRORS.FALLBACK
}

/** Wrap an API route handler and guarantee no vendor errors escape */
export function apiError(message: string, status: number = 400) {
  return Response.json({ error: message }, { status })
}
