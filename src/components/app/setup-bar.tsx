"use client"

/**
 * The strip that follows you until setup is done.
 *
 * ── WHY A BAR AND NOT A TOUR ──────────────────────────────────────────
 *
 * A spotlight tour is the obvious answer and the wrong one. It arrives at the
 * moment somebody is least able to absorb it, it blocks the thing they came to
 * do, and the button most people press is Skip — after which the product has
 * spent its one shot at explaining itself and has nothing left.
 *
 * A bar is the opposite trade. It never blocks anything, it is readable at a
 * glance without being read, and — the part that matters — it is still there
 * tomorrow. Somebody who signs up, gets distracted, and comes back on Thursday
 * finds their place rather than an empty dashboard.
 *
 * ── WHAT IT SAYS ──────────────────────────────────────────────────────
 *
 * One step. Not four. A checklist belongs on Overview, where there is room for
 * it and where somebody has gone to see where things stand; a bar that follows
 * you everywhere gets one line, and that line is the *next* thing, because that
 * is the only part that is actionable from wherever you happen to be.
 *
 * ── DISMISSAL ─────────────────────────────────────────────────────────
 *
 * It can be hidden, and the choice is remembered per step. Not permanently:
 * dismissing "build an agent" should not also hide "make a test call", because
 * those are different pieces of information and somebody who wanted rid of the
 * first almost certainly still wants the second.
 *
 * The state lives in `sessionStorage`, not a database column and not a cookie.
 * A dismissal is a "not now", it should not survive to another day, and it is
 * not worth a migration or a round trip. `sessionStorage` says exactly that.
 *
 * Reading it has to happen in an effect rather than during render, because the
 * server has no idea what is in it — reading during render produces markup that
 * disagrees with the server's and React replaces the whole subtree. So the bar
 * mounts visible and hides itself, which is also the safer way round: a bug
 * here shows guidance that should have been hidden rather than hiding guidance
 * that should have been shown.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { IconArrow, IconClose, IconCheck } from "@/components/app/icons"
import { cn } from "@/lib/utils"

export type SetupBarProps = {
  stepKey: string
  title: string
  body: string
  href: string
  cta: string
  done: number
  total: number
  /** True when this step is one only the Hi-Astrix team can complete. */
  waiting?: boolean
}

const KEY = (step: string) => `hiastrix.setup.dismissed.${step}`

export function SetupBar({
  stepKey, title, body, href, cta, done, total, waiting,
}: SetupBarProps) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY(stepKey)) === "1") setHidden(true)
    } catch {
      // Private browsing, or storage disabled. Showing the bar is the correct
      // failure: it is guidance, not a modal.
    }
  }, [stepKey])

  if (hidden) return null

  function dismiss() {
    setHidden(true)
    try { sessionStorage.setItem(KEY(stepKey), "1") } catch { /* see above */ }
  }

  return (
    <div className="border-b border-line bg-brand-500/[0.07]">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 lg:px-10">
        {/* Progress, as dots. A bar this thin has no room for a progress bar,
            and "2 of 4" alone does not show how much is left at a glance. */}
        <span className="flex shrink-0 items-center gap-1.5" aria-label={`${done} of ${total} steps done`}>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                i < done ? "bg-brand-400" : "bg-line-strong"
              )}
            />
          ))}
        </span>

        <p className="min-w-0 flex-1 text-[12.5px] text-muted">
          <span className="font-medium text-fg">
            {done === 0 ? "Let's get your phone answered" : `Step ${done + 1} of ${total}`}
            {" — "}
            {title}.
          </span>{" "}
          <span className="font-light">{body}</span>
        </p>

        {waiting ? (
          // Nothing to click. Offering a button for a step somebody cannot
          // complete sends them to a page to look for a control that is not
          // there, which reads as a broken product rather than as a queue.
          <span className="shrink-0 text-[12px] font-light text-subtle">
            Nothing to do — we&rsquo;ll set this up for you
          </span>
        ) : (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-field border border-line-strong bg-field px-3 py-1.5 text-[12.5px] font-medium text-fg transition-colors hover:border-brand-400"
          >
            {cta}
            <IconArrow size={13} />
          </Link>
        )}

        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide this until next time"
          title="Hide this until next time"
          className="shrink-0 rounded-sm p-1 text-subtle transition-colors hover:bg-field-hover hover:text-fg"
        >
          <IconClose size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * Shown once, on the visit where the last step is completed.
 *
 * Closing the loop is not decoration. A setup flow that simply stops appearing
 * leaves somebody wondering whether they finished it or whether it broke, and
 * "did I do that right" is the thought that generates a support email.
 */
export function SetupDoneBar() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem("hiastrix.setup.celebrated") === "1") setHidden(true)
    } catch { /* fine */ }
  }, [])

  if (hidden) return null

  function dismiss() {
    setHidden(true)
    try { sessionStorage.setItem("hiastrix.setup.celebrated", "1") } catch { /* fine */ }
  }

  return (
    <div className="border-b border-line bg-success/[0.08]">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-6 py-2.5 lg:px-10">
        <IconCheck size={15} className="shrink-0 text-success" />
        <p className="min-w-0 flex-1 text-[12.5px] text-muted">
          <span className="font-medium text-fg">You&rsquo;re set up.</span>{" "}
          <span className="font-light">
            Your agent is live and answering. From here, the useful next step is a campaign —
            hand it a list and it works through it on its own.
          </span>
        </p>
        <Link
          href="/dashboard/campaigns/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-field border border-line-strong bg-field px-3 py-1.5 text-[12.5px] font-medium text-fg transition-colors hover:border-brand-400"
        >
          Start a campaign
          <IconArrow size={13} />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-sm p-1 text-subtle transition-colors hover:bg-field-hover hover:text-fg"
        >
          <IconClose size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * Something is stopping calls. Louder, and not dismissible.
 *
 * The distinction from `SetupBar` is deliberate. A setup step is advice and can
 * be waved away; "your phone is not being answered and you are losing calls"
 * is not advice, and a tenant who hides it and then forgets has been failed by
 * the interface rather than served by it. It goes away when the thing is fixed
 * and not before.
 */
export function BlockerBar({
  severity, title, body, href, cta,
}: {
  severity: "danger" | "warning"
  title: string
  body: string
  href: string
  cta: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "border-b",
        severity === "danger"
          ? "border-danger/25 bg-danger/[0.09]"
          : "border-warning/25 bg-warning/[0.09]"
      )}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 lg:px-10">
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full",
            severity === "danger" ? "bg-danger" : "bg-warning"
          )}
        />
        <p className="min-w-0 flex-1 text-[12.5px] text-muted">
          <span className={cn("font-medium", severity === "danger" ? "text-danger" : "text-warning")}>
            {title}.
          </span>{" "}
          <span className="font-light">{body}</span>
        </p>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-field border border-line-strong bg-field px-3 py-1.5 text-[12.5px] font-medium text-fg transition-colors hover:border-brand-400"
        >
          {cta}
          <IconArrow size={13} />
        </Link>
      </div>
    </div>
  )
}
