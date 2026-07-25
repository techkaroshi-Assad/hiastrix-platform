/**
 * GET /auth/callback
 *
 * Handles Supabase auth redirects — email verification and password reset links
 * both land here. Supabase appends a one-time code to this URL.
 *
 * This page is on app.hiastrix.com — the tenant never sees any *.supabase.co URL.
 * Configured in Supabase Auth → URL Configuration → Redirect URLs.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Redirect to the intended destination (dashboard or update-password page)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // On error — redirect to login with a generic message, no Supabase details exposed
  return NextResponse.redirect(`${origin}/login?error=link_expired`)
}
