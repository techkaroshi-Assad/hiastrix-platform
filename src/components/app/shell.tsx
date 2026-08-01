/**
 * The signed-in shell.
 *
 * ── WHAT CHANGED, AND WHY IT MATTERED ─────────────────────────────────
 *
 * This used to be one component that every page rendered for itself:
 *
 *     <AppShell nav={tenantNav("calls")} heading="Calls" userEmail={email}>
 *
 * which meant the sidebar, the logo, the theme toggle and the nav were torn
 * down and rebuilt on every single navigation. Next has a mechanism for exactly
 * this — a `layout.tsx` persists across route changes and only `children`
 * swaps — and the app was not using it. So moving between two pages re-mounted
 * roughly forty components that had not changed, and, worse, meant there was
 * nowhere to put a `loading.tsx`: with no layout boundary, a slow page simply
 * left you looking at the *previous* page until its query finished. Nothing
 * moved, nothing spun, and the app felt slow whether or not it was.
 *
 * So this file now exports two things instead of one:
 *
 *   `Shell` — the frame. Rendered once, by `dashboard/layout.tsx` and by
 *             `admin/layout.tsx`. Owns the sidebar and the mobile rail.
 *   `Page`  — the per-route header and content well. Rendered by each page.
 *
 * The split is what makes an instant sidebar and a skeleton both possible.
 *
 * ── THE ACTIVE ITEM ───────────────────────────────────────────────────
 *
 * Nav items no longer carry an `active` flag chosen by the page, because the
 * page no longer renders the nav. `NavRail` reads the pathname instead, which
 * has the pleasant side effect of making it impossible to ship a page that
 * highlights the wrong tab — a bug the old `tenantNav("agents")` argument
 * invited every time a route was copied.
 *
 * ── THE LOOK ──────────────────────────────────────────────────────────
 *
 * The auth pages are glass over a live canvas with a violet bloom and a grain
 * overlay. The dashboard shared exactly one thing with them: the background
 * colour. Somebody signed up through a beautiful door and landed in a
 * spreadsheet.
 *
 * The atmosphere is carried through here — glass on the rail and the header, a
 * bloom behind the page title, and content that rises in on navigation.
 *
 * Two things are deliberately NOT carried through.
 *
 * **The canvas.** It runs an animation loop forever, and this is a screen
 * people leave open all day on a laptop. A dashboard that costs battery is a
 * dashboard people close.
 *
 * **The grain.** This one was tried and removed, and the reason is worth
 * writing down. Film grain over an animated gradient reads as texture; the same
 * grain over a table of 12px tabular numbers reads as a dirty screen. It sat
 * fixed above every element in the app and cost legibility on the one kind of
 * content this product exists to show. Atmosphere belongs behind content, not
 * on top of it — the bloom and the glass stay because they are behind things.
 */

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Logo } from "@/components/brand/logo"
import { SignOutButton } from "@/components/app/sign-out-button"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { cn } from "@/lib/utils"
import type { NavItem } from "@/components/app/app-shell"

/* ── Which tab is lit ──────────────────────────────────────────────────── */

function useIsActive() {
  const pathname = usePathname()
  return (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/* ── The frame ─────────────────────────────────────────────────────────── */

export function Shell({
  nav,
  userEmail,
  children,
}: {
  nav: NavItem[]
  userEmail?: string
  children: React.ReactNode
}) {
  const isActive = useIsActive()

  return (
    <div className="relative flex min-h-screen bg-ink">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sticky top-0 z-30 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line px-4 py-6 lg:flex">
        {/* Glass, and a bloom behind it so the rail is not a flat slab. Both
            are behind the content, hence the -z-10 and the relative children. */}
        <div aria-hidden="true" className="glass absolute inset-0 -z-10 rounded-none border-0 border-r border-line" />
        <div aria-hidden="true" className="wash-glow-top pointer-events-none absolute inset-0 -z-10 opacity-60" />

        <Link href="/" className="relative mb-8 px-2">
          <Logo size={26} />
        </Link>

        <nav className="relative flex-1 space-y-0.5">
          {nav.map(item => {
            const active = isActive(item)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] transition-colors",
                  active
                    ? "bg-field-hover font-medium text-fg"
                    : "text-muted hover:bg-field-soft hover:text-fg"
                )}
              >
                {/* A hairline on the active item's left edge. Cheaper to read
                    than the fill alone, and it survives a light theme where
                    the fill is nearly invisible. */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-brand-400"
                  />
                )}
                <span
                  className={cn(
                    "shrink-0 transition-colors",
                    active ? "text-brand-300" : "text-subtle group-hover:text-muted"
                  )}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="relative mt-6 space-y-3 border-t border-line pt-4">
          <ThemeToggle className="w-full justify-between" />
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
        {/* Horizontal rail replaces the sidebar below `lg`. It now carries the
            icons: dropping them on the size where labels are most cramped was
            exactly backwards. */}
        <nav className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur-xl lg:hidden">
          <div className="flex items-center gap-3 px-4 pt-3">
            <Logo size={22} />
          </div>
          <div className="flex gap-1 overflow-x-auto px-4 py-2.5">
            {nav.map(item => {
              const active = isActive(item)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
                    active
                      ? "bg-field-hover font-medium text-fg"
                      : "text-muted hover:text-fg"
                  )}
                >
                  <span className={cn("shrink-0", active ? "text-brand-300" : "text-subtle")}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              )
            })}
          </div>
        </nav>

        {children}
      </div>
    </div>
  )
}

/* The rest of the shell — `Page`, `StatCard`, `EmptyState` — lives in
   `app-shell.tsx`, which has no "use client" and therefore stays on the
   server. Only the parts that genuinely need the pathname are here. */
