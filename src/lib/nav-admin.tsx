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

export function adminNav(): NavItem[] {
  return [
    // `exact`, because /admin is a prefix of every route below it.
    { href: "/admin",          label: "Overview",      icon: <IconHome />,     exact: true },
    { href: "/admin/tenants",  label: "Tenants",       icon: <IconTenants />  },
    { href: "/admin/packages", label: "Packages",      icon: <IconPackages /> },
    { href: "/admin/numbers",  label: "Phone numbers", icon: <IconNumbers />  },
    { href: "/admin/calls",    label: "All calls",     icon: <IconCalls />    },
    { href: "/admin/settings", label: "Settings",      icon: <IconSettings /> },
  ]
}
