/**
 * The tenant shell, rendered once.
 *
 * Before this file existed, every page under /dashboard rendered its own copy
 * of the sidebar. Two things followed from that, and both were bad.
 *
 * The sidebar re-mounted on every navigation — logo, nine links, theme toggle,
 * sign-out button — none of which had changed. And because there was no layout
 * boundary, Next had nowhere to hang a loading state, so clicking "Calls" left
 * you looking at the page you were leaving until the database answered. No
 * spinner, no skeleton, nothing moving. The app was not necessarily slow; it
 * simply had no way of saying it was working.
 *
 * With the shell here, the rail is instant and `loading.tsx` files can exist.
 *
 * `requireTenant` is called here *and* in each page, deliberately.
 * `getTenantContext` is wrapped in React's `cache`, so the second call inside
 * one request is free — and having the guard in both places means a page can
 * never accidentally render for a signed-out visitor because somebody forgot
 * it, which is the failure mode a layout-only guard invites.
 */

import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { Shell } from "@/components/app/shell"

export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { email } = await requireTenant()

  return (
    <Shell nav={tenantNav()} userEmail={email}>
      {children}
    </Shell>
  )
}
