/**
 * Proxy (Next.js 16 — replaces middleware.ts)
 *
 * SECURITY: Uses server-side Supabase only.
 * No NEXT_PUBLIC_ Supabase variables — credentials never reach the browser.
 * Tenants see only app.hiastrix.com URLs, never any vendor URLs.
 *
 * Role is read from `app_metadata` first. That claim is settable only with the
 * service-role key, whereas `user_metadata` is writable by the account holder,
 * so app_metadata is the trustworthy one. The user_metadata fallback exists for
 * accounts provisioned before this distinction was drawn.
 *
 * This is a routing guard, not the authorisation boundary — every /admin page
 * independently re-checks the admin_users table, which is the source of truth.
 */

import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Server-side only — SUPABASE_URL and SUPABASE_ANON_KEY are NOT NEXT_PUBLIC_
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  const role = user
    ? ((user.app_metadata as Record<string, unknown> | undefined)?.role as string | undefined) ??
      (user.user_metadata?.role as string | undefined)
    : undefined

  const isOperator = role === "super_admin" || role === "admin"

  // ── Protect /admin routes ──────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
    if (!isOperator) {
      // Tenant trying to access admin — redirect silently, no error shown
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }
  }

  // ── Protect /dashboard routes ──────────────────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
  }

  // ── Redirect authenticated users away from login/signup ────────────────
  if ((pathname === "/login" || pathname === "/signup") && user) {
    return NextResponse.redirect(
      new URL(isOperator ? "/admin" : "/dashboard", request.url)
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Skip static files and machine-to-machine routes.
    //
    // api/tools is the CRM tool endpoint the voice provider calls mid-call. It
    // carries no session, so proxying it would redirect the provider to the sign-in
    // page and the caller would hear silence where an answer should be. It
    // authenticates on the shared secret instead, in the route itself.
    //
    // api/cron is the dialer heartbeat. Same reasoning, plus one more: proxying
    // it would make every tick call the auth provider to resolve a session that
    // does not exist, so outbound calling would stop whenever sign-in was having
    // a bad day. It authenticates on CRON_SECRET.
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/tools|api/cron|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
