/**
 * Per-route header, and the pieces pages build out of.
 *
 * The frame — sidebar, mobile rail, grain — lives in `shell.tsx`, which is a
 * client component because it reads the pathname. Everything here is
 * hook-free and stays on the server, so a page rendering forty `StatCard`s
 * ships no JavaScript for them.
 *
 * See `shell.tsx` for why the two were split apart at all.
 */

import Link from "next/link"
import { cn } from "@/lib/utils"

/** Shared measure for header and content so their left edges line up exactly. */
const MEASURE = "mx-auto w-full max-w-[1400px]"

export type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  /**
   * Match this href exactly rather than as a prefix.
   *
   * Needed for section roots: `/dashboard` is a prefix of every other tenant
   * route, so without this every tab would light up at once.
   */
  exact?: boolean
}

/* ── One route's header and content ────────────────────────────────────── */

/**
 * Rendered by every page as its outermost element.
 *
 * The header is sticky and separate from the content well so that a long table
 * keeps its title visible while scrolling — and, because `Page` lives inside
 * the persistent `Shell`, replacing it on navigation replaces only this, which
 * is the whole point of the split.
 */
export function Page({
  heading,
  description,
  actions,
  children,
}: {
  heading: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <>
      <header className="sticky top-0 z-20 overflow-hidden border-b border-line bg-ink/80 px-6 py-5 backdrop-blur-xl lg:top-0 lg:px-10">
        {/* The bloom from the sign-in page, at a fraction of the strength. Any
            more and it competes with the content underneath it. */}
        <div aria-hidden="true" className="wash-glow-top pointer-events-none absolute inset-0 opacity-40" />
        <div className={cn(MEASURE, "relative flex flex-wrap items-center justify-between gap-4")}>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.025em]">{heading}</h1>
            {description && (
              <p className="mt-1 text-[13.5px] font-light text-muted">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
        </div>
      </header>

      <div className="flex-1 px-6 py-8 lg:px-10">
        <div className={cn(MEASURE, "animate-rise-in")}>{children}</div>
      </div>
    </>
  )
}

/* ── Building blocks ───────────────────────────────────────────────────── */

/**
 * A number, and what it is.
 *
 * `trend` and `spark` are both optional and both worth having. A figure with
 * no comparison is not information — "412 calls" is only good or bad next to
 * last month — and the sparkline answers "how did it get there", which the
 * single number cannot.
 */
export function StatCard({
  label,
  value,
  meta,
  icon,
  trend,
  spark,
  href,
}: {
  label: string
  value: string
  meta?: string
  icon?: React.ReactNode
  /** Percentage change against the previous comparable period. */
  trend?: { pct: number; label?: string; goodWhenUp?: boolean }
  /** A small series drawn behind the number. Raw values; scaling is internal. */
  spark?: React.ReactNode
  href?: string
}) {
  const body = (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-line bg-linear-to-b from-field to-field-soft p-5 transition-colors",
        href && "hover:border-line-strong"
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-[14%] top-0 h-px bg-linear-to-r from-transparent via-line-strong to-transparent"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">
          {label}
        </div>
        {icon && <span className="shrink-0 text-subtle">{icon}</span>}
      </div>

      <div className="mt-2.5 flex items-end gap-3">
        <div className="text-[26px] font-semibold tracking-[-0.03em]">{value}</div>
        {trend && <TrendChip {...trend} />}
      </div>

      {meta && <div className="mt-1 text-[12px] font-light text-muted">{meta}</div>}

      {spark && <div className="mt-3 -mb-1">{spark}</div>}
    </div>
  )

  return href ? <Link href={href} className="block">{body}</Link> : body
}

/**
 * Up is not always good.
 *
 * Cost rising and connection rate rising are opposite news, and colouring both
 * green because the arrow points the same way is how a dashboard teaches people
 * to ignore it. `goodWhenUp` defaults to true because most things here are
 * volumes; anything that is a cost passes false.
 */
export function TrendChip({
  pct,
  label,
  goodWhenUp = true,
}: {
  pct: number
  label?: string
  goodWhenUp?: boolean
}) {
  const flat = Math.abs(pct) < 0.5
  const good = flat ? null : pct > 0 === goodWhenUp

  return (
    <span
      className={cn(
        "mb-1 inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-[11.5px] font-medium",
        flat && "bg-field-hover text-subtle",
        good === true && "bg-success/12 text-success",
        good === false && "bg-danger/12 text-danger"
      )}
      title={label}
    >
      {flat ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  secondary,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
  /** A second, quieter way out. Usually "read how this works". */
  secondary?: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-field-soft px-8 py-16 text-center">
      <div aria-hidden="true" className="wash-glow-top pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10 text-brand-300">
        {icon}
      </div>
      <h3 className="relative mt-5 text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="relative mx-auto mt-2 max-w-sm text-[13.5px] font-light leading-relaxed text-muted">
        {body}
      </p>
      {(action || secondary) && (
        <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondary}
        </div>
      )}
    </div>
  )
}
