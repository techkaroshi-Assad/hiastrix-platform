/**
 * Single source of truth for tenant dashboard navigation.
 *
 * It used to take the active key as an argument — `tenantNav("agents")` — and
 * every page passed its own. That made the highlight a thing each page could
 * get wrong, and copying a route to make a new one got it wrong reliably. The
 * rail now reads the pathname itself, so there is nothing to pass and nothing
 * to forget.
 */

import {
  IconHome,
  IconAgents,
  IconCalls,
  IconCampaigns,
  IconAnalytics,
  IconNumbers,
  IconBilling,
  IconSettings,
  IconHelp,
} from "@/components/app/icons"
import type { NavItem } from "@/components/app/app-shell"

export function tenantNav(): NavItem[] {
  return [
    // `exact`, because /dashboard is a prefix of everything below it.
    { href: "/dashboard",           label: "Overview",      icon: <IconHome />,      exact: true },
    { href: "/dashboard/agents",    label: "Agents",        icon: <IconAgents />    },
    // Sits next to Agents rather than next to Calls: a campaign is something you
    // set an agent to do, not a record of something that happened.
    { href: "/dashboard/campaigns", label: "Campaigns",     icon: <IconCampaigns /> },
    { href: "/dashboard/calls",     label: "Calls",         icon: <IconCalls />     },
    { href: "/dashboard/analytics", label: "Analytics",     icon: <IconAnalytics /> },
    { href: "/dashboard/numbers",   label: "Phone numbers", icon: <IconNumbers />   },
    { href: "/dashboard/billing",   label: "Billing",       icon: <IconBilling />   },
    { href: "/dashboard/settings",  label: "Settings",      icon: <IconSettings />  },
    // Last, and always present. Somebody looking for help is not going to guess
    // that it lives inside Settings.
    { href: "/dashboard/help",      label: "Help",          icon: <IconHelp />      },
  ]
}
