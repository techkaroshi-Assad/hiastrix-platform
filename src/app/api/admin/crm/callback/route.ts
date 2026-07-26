/**
 * GET /api/admin/crm/callback — finish the agency authorisation.
 *
 * Exchanges the one-time code for the agency token pair and stores it. This is
 * the only place in the platform that writes a live vendor credential to the
 * database; every other vendor key is a static environment variable.
 *
 * Always redirects back to the settings page with a short outcome in the query
 * string rather than rendering JSON — the operator arrived here from a browser
 * redirect, not a fetch.
 */

import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { exchangeAuthorizationCode } from "@/lib/crm/client"
import { STATE_COOKIE, crmRedirectUri } from "../connect/route"

export const dynamic = "force-dynamic"

function settingsUrl(request: NextRequest, outcome: string) {
  const url = new URL("/admin/settings", request.url)
  url.searchParams.set("crm", outcome)
  return url
}

function sameState(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

export async function GET(request: NextRequest) {
  const admin = await getAdminContext()
  if (!admin || admin.role !== "SUPER_ADMIN") {
    return NextResponse.redirect(settingsUrl(request, "denied"))
  }

  const code     = request.nextUrl.searchParams.get("code")
  const state    = request.nextUrl.searchParams.get("state")
  const expected = request.cookies.get(STATE_COOKIE)?.value

  // A response with no matching nonce is not one we asked for.
  if (!code || !state || !expected || !sameState(state, expected)) {
    return NextResponse.redirect(settingsUrl(request, "state"))
  }

  let outcome = "connected"
  try {
    const token = await exchangeAuthorizationCode(code, crmRedirectUri())

    const data = {
      companyId:    token.companyId!,
      accessToken:  token.access_token,
      refreshToken: token.refresh_token,
      expiresAt:    new Date(Date.now() + token.expires_in * 1000),
      connectedBy:  admin.email,
    }

    await prisma.crmConnection.upsert({
      where:  { id: true },
      update: data,
      create: { id: true, ...data },
    })
  } catch (error) {
    // Deliberately not sanitiseError — nothing from this reaches a tenant, and
    // the operator only needs to know it failed. The detail stays in the log.
    console.error("[admin/crm/callback]", error)
    outcome = "failed"
  }

  const response = NextResponse.redirect(settingsUrl(request, outcome))
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/admin/crm" })
  return response
}
