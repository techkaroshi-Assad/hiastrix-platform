"use client"

/**
 * Three-way theme control. "System" is offered explicitly rather than inferred,
 * because a user who has set their OS to switch at sunset expects the app to
 * follow rather than to be pinned by whatever they last clicked.
 */

import { useTheme, type ThemeSetting } from "./theme-provider"
import { cn } from "@/lib/utils"

const OPTIONS: { value: ThemeSetting; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a6.8 6.8 0 0 0 9.5 9.5z" />
      </svg>
    ),
  },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-field border border-line bg-field-soft p-0.5",
        className
      )}
    >
      {OPTIONS.map(opt => {
        const active = theme === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            aria-pressed={active}
            title={opt.label}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-[7px] transition-colors",
              active
                ? "bg-brand-500 text-on-brand"
                : "text-subtle hover:bg-field hover:text-fg"
            )}
          >
            {opt.icon}
            <span className="sr-only">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
