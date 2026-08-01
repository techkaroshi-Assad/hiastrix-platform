/**
 * The operations console shell, rendered once.
 *
 * Same reasoning as `dashboard/layout.tsx`: the rail persists across
 * navigation, and its existence is what allows a `loading.tsx` to exist at all.
 *
 * The guard is repeated in every page as well. The proxy blocks non-admin
 * sessions before they reach here, this layout checks the admin_users table,
 * and each page checks again — three layers, because the cost of the check is
 * a cached lookup and the cost of missing one is somebody else's tenant data.
 */

import { requireAdmin } from "@/lib/admin"
import { adminNav } from "@/lib/nav-admin"
import { Shell } from "@/components/app/shell"

export const dynamic = "force-dynamic"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await requireAdmin()

  return (
    <Shell nav={adminNav()} userEmail={admin.email}>
      {children}
    </Shell>
  )
}
