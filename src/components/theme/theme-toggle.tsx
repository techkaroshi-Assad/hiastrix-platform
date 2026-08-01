"use client"

/**
 * Three-way theme control. "System" is offered explicitly rather than inferred,
 * because a user who has set their OS to switch at sunset expects the app to
 * follow rather than to be pinned by whatever they last clicked.
 */

import { useTheme, type ThemeSetting } from "./theme-provider"
import { cn } from "@/lib/utils"
import { IconLight, IconSystem, IconDark } from "@/components/app/icons"

const OPTIONS: { value: ThemeSetting; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: <IconLight size={15} />,
  },
  {
    value: "system",
    label: "System",
    icon: <IconSystem size={15} />,
  },
  {
    value: "dark",
    label: "Dark",
    icon: <IconDark size={15} />,
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
