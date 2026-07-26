/**
 * Application root.
 *
 * app.hiastrix.com is the product surface, not the marketing site — landing
 * here should never show a holding page. Signed-in users go straight to their
 * workspace; everyone else goes to sign in.
 */

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function RootPage() {
  let destination = "/login"

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const role = user.user_metadata?.role as string | undefined
      destination = role === "super_admin" || role === "admin" ? "/admin" : "/dashboard"
    }
  } catch {
    // Never surface an infrastructure failure here — fall through to sign in.
    destination = "/login"
  }

  redirect(destination)
}
