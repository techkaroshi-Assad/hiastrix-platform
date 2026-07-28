"use client"

/** Range and metric live in the URL, so a view is shareable and survives refresh. */

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

const RANGES = [
  { days: 7,  label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
]

const METRICS = [
  { key: "calls",   label: "Calls" },
  { key: "minutes", label: "Minutes" },
  { key: "cost",    label: "Charged" },
]

export function RangePicker() {
  const pathname = usePathname()
  const params = useSearchParams()

  const days = params.get("days") ?? "30"
  const metric = params.get("metric") ?? "calls"

  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) next.set(k, v)
    return `${pathname}?${next.toString()}`
  }

  const pill = (active: boolean) =>
    cn(
      "rounded-field border px-3.5 py-2 text-[12.5px] transition-colors",
      active
        ? "border-brand-500/50 bg-brand-500/12 text-brand-on-tint"
        : "border-line bg-field text-muted hover:bg-field-hover hover:text-fg"
    )

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {RANGES.map(r => (
          <Link key={r.days} href={href({ days: String(r.days) })} className={pill(days === String(r.days))}>
            {r.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {METRICS.map(m => (
          <Link key={m.key} href={href({ metric: m.key })} className={pill(metric === m.key)}>
            {m.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
