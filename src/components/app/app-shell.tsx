/**
 * Signed-in application shell — sidebar, top bar, content well.
 *
 * Deliberately provider-agnostic: it renders brand and navigation only.
 * White-label theming will later swap `Logo` and the accent token per tenant
 * without touching this file.
 *
 * Layout contract: the sidebar is a fixed 248px rail; the main column is
 * `min-w-0 flex-1` so long content can never push the page sideways. Header
 * and content share one `max-w-[1400px]` measure and are centred, so the UI
 * stays a readable column on ultrawide displays instead of stretching to
 * both corners.
 */

import Link from "next/link"
import { Logo } from "@/components/brand/logo"
import { SignOutButton } from "@/components/app/sign-out-button"
import { cn } from "@/lib/utils"

/** Shared measure for header and content so their left edges line up exactly. */
const MEASURE = "mx-auto w-full max-w-[1400px]"

export type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  /** Marks the currently active route */
  active?: boolean
}

export function AppShell({
  nav,
  heading,
  description,
  actions,
  userEmail,
  children,
}: {
  nav: NavItem[]
  heading: string
  description?: string
  actions?: React.ReactNode
  userEmail?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-ink">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-white/[0.07] bg-ink-2/60 px-4 py-6 lg:flex">
        <Link href="/" className="mb-8 px-2">
          <Logo size={26} />
        </Link>

        <nav className="flex-1 space-y-0.5">
          {nav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] transition-colors",
                item.active
                  ? "bg-white/[0.06] font-medium text-fg"
                  : "text-muted hover:bg-white/[0.03] hover:text-fg"
              )}
            >
              <span className={cn("shrink-0", item.active ? "text-brand-300" : "text-subtle")}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-6 border-t border-white/[0.07] pt-4">
          {userEmail && (
            <div className="mb-2 truncate px-3 text-[11.5px] text-subtle" title={userEmail}>
              {userEmail}
            </div>
          )}
          <SignOutButton />
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-ink/80 px-6 py-5 backdrop-blur-xl lg:px-10">
          <div className={cn(MEASURE, "flex flex-wrap items-center justify-between gap-4")}>
            <div className="min-w-0">
              <div className="mb-4 lg:hidden">
                <Logo size={24} />
              </div>
              <h1 className="truncate text-[22px] font-semibold tracking-[-0.025em]">{heading}</h1>
              {description && (
                <p className="mt-1 text-[13.5px] font-light text-muted">{description}</p>
              )}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
          </div>
        </header>

        {/* Horizontal rail replaces the sidebar below `lg`, where it is hidden. */}
        <nav className="border-b border-white/[0.07] bg-ink-2/40 lg:hidden">
          <div className="flex gap-1 overflow-x-auto px-4 py-2.5">
            {nav.map(item => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
                  item.active
                    ? "bg-white/[0.06] font-medium text-fg"
                    : "text-muted hover:text-fg"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="flex-1 px-6 py-8 lg:px-10">
          <div className={MEASURE}>{children}</div>
        </div>
      </div>
    </div>
  )
}

/* ── Building blocks ───────────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  meta,
}: {
  label: string
  value: string
  meta?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-linear-to-b from-white/[0.035] to-white/[0.012] p-5">
      <span
        aria-hidden="true"
        className="absolute inset-x-[14%] top-0 h-px bg-linear-to-r from-transparent via-white/20 to-transparent"
      />
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</div>
      <div className="mt-2.5 text-[26px] font-semibold tracking-[-0.03em]">{value}</div>
      {meta && <div className="mt-1 text-[12px] font-light text-muted">{meta}</div>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] px-8 py-16 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(50% 60% at 50% 0%, rgba(124,92,255,.10), transparent 70%)",
        }}
      />
      <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10 text-brand-300">
        {icon}
      </div>
      <h3 className="relative mt-5 text-[16px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="relative mx-auto mt-2 max-w-sm text-[13.5px] font-light leading-relaxed text-muted">
        {body}
      </p>
      {action && <div className="relative mt-6 flex justify-center">{action}</div>}
    </div>
  )
}
