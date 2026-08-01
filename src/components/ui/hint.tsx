/**
 * The "what does this actually do" button.
 *
 * ── THE PROBLEM IT SOLVES ─────────────────────────────────────────────
 *
 * The agent editor has about thirty settings and the campaign form has twenty.
 * Some are obvious. Several are not obvious to anybody who has not built a
 * phone system before — "Silence timeout", "Stop speaking after N words",
 * "Voicemail detection", "Structured data" — and the honest answer for those is
 * a paragraph, not a label.
 *
 * A paragraph under every field makes a form nobody can scan. A link to the
 * help page makes people lose their place. So: a small `?` that opens a short
 * explanation in place, and closes again.
 *
 * ── WHY `<details>` AND NOT A TOOLTIP ─────────────────────────────────
 *
 * A hover tooltip is unreachable on a phone, unreachable by keyboard unless you
 * build focus handling yourself, and vanishes the moment you move the mouse
 * toward the thing you were reading. Every one of those is disqualifying for
 * text somebody actually needs to read rather than glance at.
 *
 * `<details>` is a click to open, a click to close, keyboard-operable for free,
 * findable by Ctrl+F, and needs no JavaScript at all — so this renders on the
 * server along with the form it annotates.
 *
 * ── ON LENGTH ─────────────────────────────────────────────────────────
 *
 * Two or three sentences. If a setting needs more than that, it belongs in the
 * help page and the hint should link there — `href` exists for exactly that.
 * A hint that turns into an essay is a hint nobody opens twice.
 */

import Link from "next/link"
import { cn } from "@/lib/utils"

export function Hint({
  children,
  label = "What does this do?",
  href,
  hrefLabel = "Read more",
  align = "left",
}: {
  children: React.ReactNode
  /** Accessible name. Worth setting to the field's own name. */
  label?: string
  /** Deep link into the help page, for anything that needs the long version. */
  href?: string
  hrefLabel?: string
  /** Which edge the popover hangs from. `right` for anything near the edge. */
  align?: "left" | "right"
}) {
  return (
    <details className="group relative inline-block align-middle">
      <summary
        aria-label={label}
        title={label}
        className={cn(
          "flex h-4 w-4 cursor-pointer list-none items-center justify-center rounded-full",
          "border border-line-strong text-[10px] leading-none font-medium text-subtle",
          "transition-colors hover:border-brand-400 hover:text-fg",
          "group-open:border-brand-400 group-open:bg-brand-500/15 group-open:text-brand-on-tint",
          "[&::-webkit-details-marker]:hidden"
        )}
      >
        ?
      </summary>

      {/* z-30 so it clears the sticky page header, which is z-20. A popover
          that opens behind the thing above it is worse than no popover. */}
      <div
        className={cn(
          "absolute top-6 z-30 w-[280px] rounded-field border border-line-strong bg-panel p-3.5 shadow-xl",
          "text-[12.5px] font-light leading-relaxed text-muted",
          align === "left" ? "left-0" : "right-0"
        )}
      >
        {children}
        {href && (
          <Link
            href={href}
            className="mt-2 block text-[12px] font-normal text-brand-on-tint underline-offset-4 hover:underline"
          >
            {hrefLabel} →
          </Link>
        )}
      </div>
    </details>
  )
}

/**
 * A field label with a hint attached.
 *
 * Exists so the two are never accidentally laid out differently in different
 * forms — a `?` that sits half a line high in one place and centred in another
 * is the kind of thing nobody reports and everybody notices.
 */
export function LabelWithHint({
  children,
  hint,
  href,
}: {
  children: React.ReactNode
  hint: React.ReactNode
  href?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <Hint label={typeof children === "string" ? children : "What does this do?"} href={href}>
        {hint}
      </Hint>
    </span>
  )
}
