/**
 * POST /api/auth/reset-password
 *
 * Triggers a password reset email via Supabase.
 * The reset link in the email points to app.hiastrix.com — never to *.supabase.co.
 * Supabase custom SMTP (Resend) must be configured so emails come from hiastrix.com.
 *
 * We always return the same message regardless of whether the email exists,
 * to prevent user enumeration attacks.
 */

import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ERRORS, sanitiseError } from "@/lib/errors"
import { z } from "zod"

const ResetSchema = z.object({
  email: z.string().email(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = ResetSchema.safeParse(body)

    if (!parsed.success) {
      // Still return the generic message — no info leakage
      return Response.json({ message: ERRORS.RESET_EMAIL_SENT }, { status: 200 })
    }

    const supabase = await createClient()

    // redirectTo must be your domain — Supabase will append the token
    // This requires "app.hiastrix.com" to be listed in Supabase Auth → URL Configuration → Redirect URLs
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      // Fallback matches signup. Without it an unset APP_URL produces the string
      // "undefined/auth/callback", which the provider rejects as off-list and
      // silently swaps for its own Site URL — sending the customer to whatever
      // that happens to be.
      redirectTo: `${process.env.APP_URL ?? "https://app.hiastrix.com"}/auth/callback?next=/auth/update-password`,
    })

    // Always return the same response — never reveal if email exists or not
    return Response.json({ message: ERRORS.RESET_EMAIL_SENT }, { status: 200 })

  } catch (error) {
    // Log server-side but still return the same generic message
    console.error("[reset-password]", error)
    return Response.json({ message: ERRORS.RESET_EMAIL_SENT }, { status: 200 })
  }
}
