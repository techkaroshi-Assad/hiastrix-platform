/**
 * Supabase Server-Side Client
 *
 * SECURITY: These clients are ONLY used in server components, API routes,
 * and middleware. They are NEVER imported in client components.
 *
 * No NEXT_PUBLIC_ variables are used here — Supabase credentials are
 * server-side only and are never bundled into client-side JavaScript.
 * Tenants never see any Supabase URL, key, or branding anywhere.
 */

import { createServerClient } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

/** Session-aware client — reads/writes auth cookies server-side */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.SUPABASE_URL!,       // NOT NEXT_PUBLIC_ — server only
    process.env.SUPABASE_ANON_KEY!,  // NOT NEXT_PUBLIC_ — server only
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Safe to ignore in Server Components (read-only cookie store)
          }
        },
      },
    }
  )
}

/**
 * Service role client — bypasses RLS.
 * Use ONLY in: webhook handlers, admin-initiated operations.
 * NEVER expose this client or its responses to tenant-facing routes.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
