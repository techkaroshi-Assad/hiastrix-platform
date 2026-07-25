/**
 * POST /api/auth/update-password
 *
 * Updates password after the user has clicked the reset link.
 * The reset link lands on /auth/update-password (our page),
 * which calls this API route — no Supabase URL ever shown.
 */

import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { sanitiseError, apiError, ERRORS } from "@/lib/errors"
import { z } from "zod"

const UpdatePasswordSchema = z.object({
  password: z.string().min(8),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = UpdatePasswordSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(ERRORS.WEAK_PASSWORD)
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

    if (error) {
      return apiError(sanitiseError(error, "update-password"))
    }

    return Response.json({ message: ERRORS.PASSWORD_UPDATED }, { status: 200 })

  } catch (error) {
    return apiError(sanitiseError(error, "update-password"))
  }
}
