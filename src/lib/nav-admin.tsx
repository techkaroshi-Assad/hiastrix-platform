/** Navigation for the Astrix operations console. */

import {
  IconHome,
  IconTenants,
  IconPackages,
  IconNumbers,
  IconCalls,
  IconSettings,
} from "@/components/app/icons"
import type { NavItem } from "@/components/app/app-shell"

export type AdminNavKey =
  | "overview"
  | "tenants"
  | "packages"
  | "numbers"
  | "calls"
  | "settings"

export function adminNav(active: AdminNavKey): NavItem[] {
  return [
    { href: "/admin",          label: "Overview",      icon: <IconHome />,     active: active === "overview" },
    { href: "/admin/tenants",  label: "Tenants",       icon: <IconTenants />,  active: active === "tenants"  },
    { href: "/admin/packages", label: "Packages",      icon: <IconPackages />, active: active === "packages" },
    { href: "/admin/numbers",  label: "Phone numbers", icon: <IconNumbers />,  active: active === "numbers"  },
    { href: "/admin/calls",    label: "All calls",     icon: <IconCalls />,    active: active === "calls"    },
    { href: "/admin/settings", label: "Settings",      icon: <IconSettings />, active: active === "settings" },
  ]
}
