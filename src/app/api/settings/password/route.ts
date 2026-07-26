/**
 * POST /api/settings/password — change the signed-in user's password.
 *
 * Runs entirely server-side against the session cookie. The identity provider
 * is never named in a response; failures map through sanitiseError.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getTenantContext } from "@/lib/tenant"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  password: z.string().min(8).max(200),
})

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(ERRORS.WEAK_PASSWORD)

    const supabase = await createClient()
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

    if (error) return apiError(sanitiseError(error, "settings/password"))

    return Response.json({ message: ERRORS.PASSWORD_UPDATED })
  } catch (error) {
    return apiError(sanitiseError(error, "settings/password"))
  }
}
