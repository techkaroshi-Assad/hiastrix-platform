import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AppShell, StatCard, EmptyState } from "@/components/app/app-shell"
import {
  IconHome,
  IconTenants,
  IconPackages,
  IconCalls,
  IconBilling,
  IconSettings,
} from "@/components/app/icons"

export const metadata: Metadata = { title: "Admin" }
export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const role = user.user_metadata?.role as string | undefined
  if (role !== "super_admin" && role !== "admin") redirect("/dashboard")

  const nav = [
    { href: "/admin", label: "Overview", icon: <IconHome />, active: true },
    { href: "/admin/tenants", label: "Tenants", icon: <IconTenants /> },
    { href: "/admin/packages", label: "Packages", icon: <IconPackages /> },
    { href: "/admin/calls", label: "Call log", icon: <IconCalls /> },
    { href: "/admin/revenue", label: "Revenue", icon: <IconBilling /> },
    { href: "/admin/settings", label: "Settings", icon: <IconSettings /> },
  ]

  return (
    <AppShell
      nav={nav}
      heading="Platform overview"
      description="Every tenant, package and call across Hi-Astrix."
      userEmail={user.email}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tenants" value="0" meta="No workspaces yet" />
        <StatCard label="Calls today" value="0" meta="Across all tenants" />
        <StatCard label="Minutes billed" value="0" meta="Current cycle" />
        <StatCard label="MRR" value="$0" meta="Recurring revenue" />
      </div>

      <div className="mt-6">
        <EmptyState
          icon={<IconTenants />}
          title="No tenants onboarded"
          body="Once businesses sign up they'll appear here with their usage, balance and package. You'll be able to adjust limits and issue credit from this screen."
          action={
            <span className="inline-flex h-10 cursor-not-allowed items-center rounded-field border border-white/[0.12] bg-white/[0.04] px-5 text-[13px] font-medium text-muted">
              Tenant management — coming next
            </span>
          }
        />
      </div>
    </AppShell>
  )
}
