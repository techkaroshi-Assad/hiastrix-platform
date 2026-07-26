/**
 * Tenant context resolution.
 *
 * Every tenant-facing page and API route resolves the caller through here, so
 * scoping happens in exactly one place. A request can only ever see rows
 * belonging to the tenant its signed-in user is a member of.
 *
 * Vendor-free by construction: callers get plain domain objects, never a
 * Supabase user object or a raw provider error.
 */

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

/** Resolve the signed-in user's tenant membership, or null if there isn't one. */
export async function getTenantContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const membership = await prisma.tenantUser.findUnique({
    where: { supabaseId: user.id },
    include: { tenant: { include: { package: true } } },
  })

  if (!membership || !membership.isActive) return null

  return {
    userId: user.id,
    email: membership.email,
    name: membership.name,
    role: membership.type,
    tenant: membership.tenant,
  }
}

/** Page-level guard — redirects to /login when there is no valid membership. */
export async function requireTenant() {
  const ctx = await getTenantContext()
  if (!ctx) redirect("/login")
  return ctx
}

export type TenantContext = NonNullable<Awaited<ReturnType<typeof getTenantContext>>>

/** True when the tenant is allowed to place calls right now. */
export function canOperate(tenant: TenantContext["tenant"]) {
  return tenant.status === "ACTIVE"
}
