/**
 * Single source of truth for tenant dashboard navigation.
 *
 * Every dashboard page calls `tenantNav("<key>")` so the sidebar stays
 * identical across routes and only the active item differs.
 */

import {
  IconHome,
  IconAgents,
  IconCalls,
  IconNumbers,
  IconBilling,
  IconSettings,
} from "@/components/app/icons"
import type { NavItem } from "@/components/app/app-shell"

export type NavKey =
  | "overview"
  | "agents"
  | "calls"
  | "numbers"
  | "billing"
  | "settings"

export function tenantNav(active: NavKey): NavItem[] {
  return [
    { href: "/dashboard",          label: "Overview",      icon: <IconHome />,     active: active === "overview" },
    { href: "/dashboard/agents",   label: "Agents",        icon: <IconAgents />,   active: active === "agents"   },
    { href: "/dashboard/calls",    label: "Calls",         icon: <IconCalls />,    active: active === "calls"    },
    { href: "/dashboard/numbers",  label: "Phone numbers", icon: <IconNumbers />,  active: active === "numbers"  },
    { href: "/dashboard/billing",  label: "Billing",       icon: <IconBilling />,  active: active === "billing"  },
    { href: "/dashboard/settings", label: "Settings",      icon: <IconSettings />, active: active === "settings" },
  ]
}
