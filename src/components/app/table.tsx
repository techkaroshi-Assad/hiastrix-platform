/**
 * Presentational primitives shared by the log-style pages
 * (calls, ledger, payments, admin tenant list).
 *
 * Server-safe: no hooks, no client directive.
 */

import { cn } from "@/lib/utils"

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]",
        className
      )}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-left">{children}</table>
    </div>
  )
}

export function TH({
  children,
  align = "left",
}: {
  children: React.ReactNode
  align?: "left" | "right"
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-white/[0.06] px-5 py-3 text-[11px] font-medium uppercase tracking-[0.1em] text-subtle",
        align === "right" && "text-right"
      )}
    >
      {children}
    </th>
  )
}

export function TD({
  children,
  align = "left",
  muted,
  className,
}: {
  children: React.ReactNode
  align?: "left" | "right"
  muted?: boolean
  className?: string
}) {
  return (
    <td
      className={cn(
        "border-b border-white/[0.04] px-5 py-3.5 text-[13px]",
        align === "right" && "text-right tabular-nums",
        muted && "text-muted",
        className
      )}
    >
      {children}
    </td>
  )
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "brand"
  children: React.ReactNode
}) {
  const tones = {
    neutral: "bg-white/[0.06] text-subtle",
    success: "bg-success/12 text-success",
    warning: "bg-warning/12 text-warning",
    danger:  "bg-danger/12 text-danger",
    brand:   "bg-brand-500/15 text-brand-300",
  } as const

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-14 text-center text-[13px] text-subtle">
        {children}
      </td>
    </tr>
  )
}

/** Maps a call status to a pill tone. */
export function callTone(status: string) {
  switch (status) {
    case "COMPLETED":   return "success" as const
    case "IN_PROGRESS": return "brand" as const
    case "FAILED":      return "danger" as const
    default:            return "neutral" as const
  }
}
