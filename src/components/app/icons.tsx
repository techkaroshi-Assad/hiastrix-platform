/** Shared 18px stroke icons for navigation and empty states. */

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

export const IconHome = () => (
  <svg {...base}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
  </svg>
)

export const IconAgents = () => (
  <svg {...base}>
    <rect x="3.5" y="7" width="17" height="12" rx="3" />
    <path d="M12 3v4M8.5 12.5v2M15.5 12.5v2M12 11.5v4" />
  </svg>
)

export const IconCalls = () => (
  <svg {...base}>
    <path d="M6.5 3.5h2l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2 4 1.5v2a2.5 2.5 0 0 1-2.7 2.5C9.6 18 6 14.4 4 6.2A2.5 2.5 0 0 1 6.5 3.5z" />
  </svg>
)

export const IconNumbers = () => (
  <svg {...base}>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M9 7h6M9 11h6M9 15h3" />
  </svg>
)

export const IconBilling = () => (
  <svg {...base}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="3" />
    <path d="M2.5 10h19" />
  </svg>
)

export const IconSettings = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
)

export const IconTenants = () => (
  <svg {...base}>
    <path d="M3 21V7l7-4v18" />
    <path d="M10 9h7a2 2 0 0 1 2 2v10" />
    <path d="M6.5 10.5v0M6.5 14.5v0M14 13v0M14 17v0" />
  </svg>
)

export const IconPackages = () => (
  <svg {...base}>
    <path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" />
    <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
  </svg>
)

export const IconAnalytics = () => (
  <svg {...base}>
    <path d="M3 20h18" />
    <path d="M6 20v-6M11 20V6M16 20v-9M21 20v-4" />
  </svg>
)

/** Outbound: a handset with a call going out of it. */
export const IconCampaigns = () => (
  <svg {...base}>
    <path d="M5.5 3.5h2l1.4 3.7-1.9 1.4a11 11 0 0 0 5 5l1.4-1.9 3.7 1.4v2a2.4 2.4 0 0 1-2.6 2.4C8.6 16.8 5.2 13.4 3.3 6.1A2.4 2.4 0 0 1 5.5 3.5z" />
    <path d="M15 9.5 21 3.5" />
    <path d="M16.5 3.5H21v4.5" />
  </svg>
)
