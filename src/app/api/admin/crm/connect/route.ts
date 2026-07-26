/**
 * GET /api/admin/crm/connect — start the one-time agency authorisation.
 *
 * Super admin only. Redirects to the provider's consent screen and drops a
 * single-use nonce in an httpOnly cookie; the callback refuses any response that
 * does not carry it back, so a link cannot be replayed at a signed-in operator to
 * bind the platform to someone else's agency.
 *
 * This route is deliberately NOT excluded from the proxy matcher. Being proxied
 * is the point — the whole flow requires a live operator session.
 */

import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { getAdminContext } from "@/lib/admin"
import { crmConfigured } from "@/lib/crm/client"
import { ERRORS, apiError } from "@/lib/errors"

export const dynamic = "force-dynamic"

const CONSENT_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation"

export const STATE_COOKIE = "crm_oauth_state"

/**
 * Requested once, at install. Widening this list later means re-running the whole
 * flow, because an existing token is never retroactively granted a new scope —
 * which is why it reaches past what the calling agent uses today.
 */
const SCOPES = [
  "oauth.readonly", "oauth.write",
  "locations.readonly", "locations.write",
  "snapshots.readonly",
  "contacts.readonly", "contacts.write",
  "opportunities.readonly", "opportunities.write",
  "calendars.readonly", "calendars.write",
  "calendars/events.readonly", "calendars/events.write",
  "conversations.readonly", "conversations/message.write",
  "locations/customFields.readonly", "locations/customFields.write",
  "locations/customValues.readonly", "locations/customValues.write",
  "locations/tags.readonly", "locations/tags.write",
  "locations/tasks.readonly", "locations/tasks.write",
].join(" ")

export function crmRedirectUri() {
  const appUrl = process.env.APP_URL ?? "https://app.hiastrix.com"
  return `${appUrl}/api/admin/crm/callback`
}

export async function GET(_request: NextRequest) {
  const admin = await getAdminContext()
  if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)
  if (admin.role !== "SUPER_ADMIN") {
    return apiError("Only a super admin can connect the CRM.", 403)
  }
  if (!crmConfigured()) {
    return apiError("The CRM integration isn't configured on this environment yet.", 400)
  }

  const state = randomBytes(32).toString("hex")

  const url = new URL(CONSENT_URL)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", crmRedirectUri())
  url.searchParams.set("client_id", process.env.CRM_CLIENT_ID ?? "")
  url.searchParams.set("scope", SCOPES)
  url.searchParams.set("state", state)

  const response = NextResponse.redirect(url.toString())
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",   // must survive the provider's cross-site redirect back
    path:     "/api/admin/crm",
    maxAge:   10 * 60,
  })
  return response
}
