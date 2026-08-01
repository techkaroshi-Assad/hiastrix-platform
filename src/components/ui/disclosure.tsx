"use client"

/**
 * A section you open.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Two screens in this app dump everything they have on the floor at once. The
 * Help page renders nine long topics end to end, so finding "how do campaigns
 * work" means scrolling past four thousand words about something else. The
 * template picker renders thirty-eight cards, so the answer to "what can I
 * start from" is a wall.
 *
 * In both cases the content is good and the *shape* is wrong. What somebody
 * wants first is the list of what exists — nine headings, six categories — and
 * then one of them opened. That is a disclosure, and it is one of the few
 * interface patterns that is genuinely just better than the alternative here.
 *
 * ── HOW IT BEHAVES, AND WHY ───────────────────────────────────────────
 *
 * **It uses `<details>`.** Not a `useState` boolean. The browser gives open and
 * closed state, keyboard operation, correct semantics for a screen reader, and
 * — the part people forget — in-page search. Ctrl+F for a word inside a closed
 * `<details>` finds it and opens the section, which no hand-rolled version does
 * without work. On a help page that is not a nicety.
 *
 * **The arrow points at what happens next.** Right when closed, down when open.
 * The default triangle is removed because it renders differently in every
 * browser and cannot be styled consistently.
 *
 * **Closed by default, with one exception.** `defaultOpen` exists for the first
 * item on a page: landing on a screen where nothing at all is open reads as
 * empty rather than as tidy. One open section says "this is a list, and they
 * open".
 */

import { cn } from "@/lib/utils"

export function Disclosure({
  title,
  summary,
  icon,
  meta,
  id,
  defaultOpen = false,
  tone = "panel",
  children,
}: {
  title: string
  /** One line under the title, readable while the section is closed. */
  summary?: string
  icon?: React.ReactNode
  /** A count or a status, right-aligned. */
  meta?: React.ReactNode
  /** Anchor target, so a hint elsewhere can deep-link to this section. */
  id?: string
  defaultOpen?: boolean
  /** `panel` is a bordered card. `plain` is a divider-separated row. */
  tone?: "panel" | "plain"
  children: React.ReactNode
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className={cn(
        "group scroll-mt-24",
        tone === "panel"
          ? "overflow-hidden rounded-2xl border border-line bg-field-soft"
          : "border-b border-line last:border-b-0"
      )}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-field-soft",
          // Safari renders its own marker unless this is also removed.
          "[&::-webkit-details-marker]:hidden",
          tone === "panel" && "group-open:border-b group-open:border-line"
        )}
      >
        {/* The caret. Rotated rather than swapped, so it turns rather than
            jumps — and `shrink-0` because a long title must not squash it. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 256 256"
          className="h-3.5 w-3.5 shrink-0 text-subtle transition-transform duration-200 group-open:rotate-90"
          fill="currentColor"
        >
          <path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z" />
        </svg>

        {icon && <span className="shrink-0 text-muted">{icon}</span>}

        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium tracking-[-0.01em]">{title}</span>
          {summary && (
            <span className="mt-0.5 block text-[12.5px] font-light leading-relaxed text-muted">
              {summary}
            </span>
          )}
        </span>

        {meta && <span className="shrink-0 text-[12px] text-subtle">{meta}</span>}
      </summary>

      <div className={cn(tone === "panel" ? "px-5 py-5" : "px-5 pb-5")}>{children}</div>
    </details>
  )
}

/**
 * A stack of them, with the first one open.
 *
 * Native `<details>` has no grouping — several can be open at once, which is
 * the right default here. Somebody comparing two help topics should not have
 * one snap shut because they opened the other, and "accordion closes the last
 * one" is a behaviour people find surprising far more often than they find it
 * helpful.
 */
export function DisclosureList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn("space-y-3", className)}>{children}</div>
}
