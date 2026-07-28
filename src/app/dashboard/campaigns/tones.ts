/**
 * Status → pill colour. Plain functions, no "use client".
 *
 * These live in their own module because both the server pages and the client
 * components need them, and a function exported from a `"use client"` file
 * cannot be *called* from a server component — only rendered as a component or
 * passed as a prop. Doing it anyway compiles perfectly well and then throws at
 * runtime:
 *
 *     Attempted to call campaignTone() from the server but campaignTone is on
 *     the client.
 *
 * Which is a blank error page, not a build failure. So the shared helpers sit
 * here, on neither side of the boundary.
 */

export type Tone = "neutral" | "success" | "warning" | "danger" | "brand"

export function campaignTone(state: string): Tone {
  switch (state) {
    case "RUNNING":   return "brand"
    case "COMPLETED": return "success"
    case "PAUSED":    return "warning"
    default:          return "neutral"
  }
}

export function leadTone(state: string): Tone {
  switch (state) {
    case "COMPLETED":   return "success"
    case "DIALING":
    case "IN_PROGRESS": return "brand"
    case "RETRY_WAIT":
    case "DEFERRED":    return "warning"
    case "FAILED":
    case "SUPPRESSED":  return "danger"
    default:            return "neutral"
  }
}

/** Campaign state → what a tenant should read. */
export const CAMPAIGN_LABEL: Record<string, string> = {
  DRAFT:     "Draft",
  RUNNING:   "Calling",
  PAUSED:    "Paused",
  COMPLETED: "Finished",
  ARCHIVED:  "Archived",
}

/** Lead state → what a tenant should read. Never the enum name. */
export const LEAD_LABEL: Record<string, string> = {
  PENDING:     "Waiting",
  RETRY_WAIT:  "Trying again later",
  DEFERRED:    "Outside calling hours",
  DIALING:     "Calling",
  IN_PROGRESS: "On the call",
  COMPLETED:   "Spoke to them",
  EXHAUSTED:   "No answer",
  FAILED:      "Couldn't reach",
  SUPPRESSED:  "Do not call",
  CANCELLED:   "Cancelled",
}
