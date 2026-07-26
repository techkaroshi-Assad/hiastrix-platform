/**
 * Admin context resolution.
 *
 * The proxy already blocks non-admin sessions from /admin, but every admin
 * page and route re-checks here as well — defence in depth, and the proxy
 * only sees session metadata whereas this consults the admin_users table,
 * which is the actual source of truth.
 */

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

export async function getAdminContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const admin = await prisma.adminUser.findUnique({
    where: { supabaseId: user.id },
  })

  if (!admin || !admin.isActive) return null

  return {
    userId: user.id,
    email:  admin.email,
    name:   admin.name,
    role:   admin.role as "SUPER_ADMIN" | "ADMIN",
  }
}

export async function requireAdmin() {
  const ctx = await getAdminContext()
  if (!ctx) redirect("/login")
  return ctx
}

export type AdminContext = NonNullable<Awaited<ReturnType<typeof getAdminContext>>>
