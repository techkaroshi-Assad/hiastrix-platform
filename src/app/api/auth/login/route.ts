/**
 * POST /api/auth/login
 *
 * Authenticates a tenant user or admin.
 * Sets an HTTP-only session cookie — Supabase never visible to browser.
 */

import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sanitiseError, apiError, ERRORS } from "@/lib/errors"
import { z } from "zod"

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = LoginSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(ERRORS.INVALID_CREDENTIALS)
    }

    const { email, password } = parsed.data
    const supabase = await createClient()

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error || !data.user) {
      return apiError(sanitiseError(error, "login"))
    }

    // Determine redirect based on role from user metadata
    const role = data.user.user_metadata?.role as string | undefined

    let redirectTo = "/dashboard"
    if (role === "super_admin" || role === "admin") {
      redirectTo = "/admin"
    }

    // Supabase SSR automatically sets the session cookie on the response.
    // The cookie is HTTP-only — the browser can't read it via JS.
    return Response.json({ redirectTo }, { status: 200 })

  } catch (error) {
    return apiError(sanitiseError(error, "login"))
  }
}
