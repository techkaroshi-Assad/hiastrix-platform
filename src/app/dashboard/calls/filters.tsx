"use client"

/**
 * Call log filter bar. Filters live in the URL so a filtered view is
 * shareable, survives a refresh, and lets the server component do the query.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback } from "react"
import { cn } from "@/lib/utils"

const CONTROL =
  "h-10 rounded-field border border-white/10 bg-white/[0.035] px-3 text-[13px] text-fg outline-none transition-colors hover:border-white/[0.16] focus:border-brand-500/65"

export function CallFilters({
  agents,
}: {
  agents: { id: string; name: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const set = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete("page") // any filter change returns to page 1
      router.push(`${pathname}?${next.toString()}`)
    },
    [params, pathname, router]
  )

  const active =
    params.get("agent") || params.get("status") || params.get("from") || params.get("to")

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <select
        aria-label="Filter by agent"
        className={cn(CONTROL, "max-w-[190px]")}
        value={params.get("agent") ?? ""}
        onChange={e => set("agent", e.target.value)}
      >
        <option value="">All agents</option>
        {agents.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by status"
        className={CONTROL}
        value={params.get("status") ?? ""}
        onChange={e => set("status", e.target.value)}
      >
        <option value="">Any status</option>
        <option value="COMPLETED">Completed</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="FAILED">Failed</option>
        <option value="NO_ANSWER">No answer</option>
        <option value="BUSY">Busy</option>
      </select>

      <input
        type="date"
        aria-label="From date"
        className={CONTROL}
        value={params.get("from") ?? ""}
        onChange={e => set("from", e.target.value)}
      />
      <input
        type="date"
        aria-label="To date"
        className={CONTROL}
        value={params.get("to") ?? ""}
        onChange={e => set("to", e.target.value)}
      />

      {active && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="h-10 rounded-field px-3 text-[13px] text-muted transition-colors hover:text-fg"
        >
          Clear
        </button>
      )}
    </div>
  )
}
