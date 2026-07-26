import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AppShell, StatCard, EmptyState } from "@/components/app/app-shell"
import {
  IconHome,
  IconAgents,
  IconCalls,
  IconNumbers,
  IconBilling,
  IconSettings,
} from "@/components/app/icons"

export const metadata: Metadata = { title: "Dashboard" }
export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const firstName =
    (user.user_metadata?.name as string | undefined)?.split(" ")[0] ?? "there"

  const nav = [
    { href: "/dashboard", label: "Overview", icon: <IconHome />, active: true },
    { href: "/dashboard/agents", label: "Agents", icon: <IconAgents /> },
    { href: "/dashboard/calls", label: "Calls", icon: <IconCalls /> },
    { href: "/dashboard/numbers", label: "Phone numbers", icon: <IconNumbers /> },
    { href: "/dashboard/billing", label: "Billing", icon: <IconBilling /> },
    { href: "/dashboard/settings", label: "Settings", icon: <IconSettings /> },
  ]

  return (
    <AppShell
      nav={nav}
      heading={`Good to see you, ${firstName}`}
      description="Here's what's happening across your workspace."
      userEmail={user.email}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Calls this month" value="0" meta="No calls placed yet" />
        <StatCard label="Active agents" value="0" meta="Create your first agent" />
        <StatCard label="Minutes used" value="0" meta="of your monthly allowance" />
        <StatCard label="Balance" value="$0.00" meta="Top up to start calling" />
      </div>

      <div className="mt-6">
        <EmptyState
          icon={<IconAgents />}
          title="No agents yet"
          body="An agent is the voice that answers or places your calls — its script, its personality, and the number it works from. Create one to get started."
          action={
            <span className="inline-flex h-10 cursor-not-allowed items-center rounded-field border border-white/[0.12] bg-white/[0.04] px-5 text-[13px] font-medium text-muted">
              Agent builder — coming next
            </span>
          }
        />
      </div>
    </AppShell>
  )
}
