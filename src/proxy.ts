/**
 * Proxy (Next.js 16 — replaces middleware.ts)
 *
 * SECURITY: Uses server-side Supabase only.
 * No NEXT_PUBLIC_ Supabase variables — credentials never reach the browser.
 * Tenants see only app.hiastrix.com URLs, never any vendor URLs.
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

  // ── Protect /admin routes ──────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
    const role = user.user_metadata?.role as string | undefined
    if (role !== "super_admin" && role !== "admin") {
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
    const role = user.user_metadata?.role as string | undefined
    const dest = (role === "super_admin" || role === "admin") ? "/admin" : "/dashboard"
    return NextResponse.redirect(new URL(dest, request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Skip static files and unauthenticated routes (webhooks, auth callback)
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
