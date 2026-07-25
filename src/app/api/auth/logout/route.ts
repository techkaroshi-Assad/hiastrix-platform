/**
 * POST /api/auth/logout
 * Clears the session cookie server-side.
 */

import { createClient } from "@/lib/supabase/server"
import { sanitiseError, apiError } from "@/lib/errors"

export async function POST() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
    return Response.json({ redirectTo: "/login" }, { status: 200 })
  } catch (error) {
    return apiError(sanitiseError(error, "logout"))
  }
}
