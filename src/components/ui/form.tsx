"use client"

/**
 * Form controls for the signed-in app.
 *
 * Kept separate from `ui/field.tsx` (which serves the auth screens) so
 * dashboard-only controls can evolve without risking the login and signup
 * flows. Styling mirrors Field so the two read as one system.
 */

import { forwardRef, useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { IconChevron, IconClose } from "@/components/app/icons"
import { Hint } from "@/components/ui/hint"

const CONTROL = [
  "w-full rounded-field bg-field text-sm text-fg",
  "border border-line placeholder:text-subtle",
  "transition-[border-color,box-shadow] duration-200 outline-none",
  "hover:border-line-strong",
  "focus:border-brand-400 focus:shadow-[0_0_0_3.5px] focus:shadow-brand-400/20",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ")

/* ── Label wrapper ─────────────────────────────────────────────────────── */

function Shell({
  id,
  label,
  hint,
  help,
  helpHref,
  children,
}: {
  id: string
  label: string
  hint?: string
  /** The paragraph behind a `?`. `hint` is the always-visible one-liner. */
  help?: React.ReactNode
  helpHref?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="block text-xs font-medium tracking-[0.01em] text-muted">
          {label}
        </label>
        {help && <Hint label={label} href={helpHref}>{help}</Hint>}
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-subtle">{hint}</p>}
    </div>
  )
}

/* ── Textarea ──────────────────────────────────────────────────────────── */

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  hint?: string
  help?: React.ReactNode
  helpHref?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ label, hint, help, helpHref, className, id, rows = 5, ...props }, ref) {
    const autoId = useId()
    const fieldId = id ?? autoId
    return (
      <Shell id={fieldId} label={label} hint={hint} help={help} helpHref={helpHref}>
        <textarea
          ref={ref}
          id={fieldId}
          rows={rows}
          className={cn(CONTROL, "resize-y px-3.5 py-2.5 leading-relaxed", className)}
          {...props}
        />
      </Shell>
    )
  }
)

/* ── Select ────────────────────────────────────────────────────────────── */

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  hint?: string
  help?: React.ReactNode
  helpHref?: string
  options: { value: string; label: string; note?: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, help, helpHref, options, placeholder, className, id, ...props },
  ref
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Shell id={fieldId} label={label} hint={hint} help={help} helpHref={helpHref}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          className={cn(CONTROL, "h-11 appearance-none px-3.5 pr-10", className)}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => (
            <option key={o.value} value={o.value}>
              {o.note ? `${o.label} — ${o.note}` : o.label}
            </option>
          ))}
        </select>
        <IconChevron
          aria-hidden="true"
          size={16}
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-subtle"
        />
      </div>
    </Shell>
  )
})

/* ── Toggle ────────────────────────────────────────────────────────────── */

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
  help,
  helpHref,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** The paragraph behind a `?`. */
  help?: React.ReactNode
  helpHref?: string
}) {
  /* The `?` sits *outside* the button, positioned over its corner.
   *
   * Not a stylistic choice: `<details>` inside a `<button>` is invalid markup
   * and browsers do not deliver the click to it — the whole row swallows it and
   * toggles the switch instead. So the row stays one big button, and the
   * popover is a sibling laid on top of it. */
  const row = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-start justify-between gap-4 rounded-field border px-3.5 py-3 text-left transition-colors",
        "border-line hover:border-line-strong",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      <span className="min-w-0">
        <span className={cn("block text-[13.5px] font-medium text-fg", help && "pr-5")}>
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-subtle">{description}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-brand-500" : "bg-toggle-off"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-knob shadow-[0_1px_2px_rgba(0,0,0,0.28)] transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  )

  if (!help) return row

  return (
    <div className="relative">
      {row}
      <span className="absolute right-14 top-3.5">
        <Hint label={label} href={helpHref} align="right">{help}</Hint>
      </span>
    </div>
  )
}

/* ── Secondary / ghost buttons ─────────────────────────────────────────── */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement>

export function SecondaryButton({ className, children, ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-field px-4",
        "border border-line bg-field text-[13px] font-medium text-fg",
        "transition-colors duration-200 hover:border-line-strong hover:bg-field-hover",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  )
}

export function DangerButton({ className, children, ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-field px-4",
        "border border-danger/30 bg-danger/10 text-[13px] font-medium text-danger",
        "transition-colors duration-200 hover:border-danger/50 hover:bg-danger/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  )
}

/* ── Collapsible section ───────────────────────────────────────────────── */

/**
 * Groups a dense form into disclosable blocks. The agent builder exposes most
 * of Vapi's surface, and showing thirty fields at once would bury the six that
 * matter for a first agent — so everything past the essentials starts closed.
 */
export function Section({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="overflow-hidden rounded-field border border-line">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-field-soft px-4 py-3 text-left transition-colors hover:bg-field"
      >
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-fg">{title}</span>
          {description && (
            <span className="mt-0.5 block text-xs leading-relaxed text-subtle">
              {description}
            </span>
          )}
        </span>
        <IconChevron
          aria-hidden="true"
          size={16}
          className={cn(
            "shrink-0 text-subtle transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open && <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>}
    </div>
  )
}

/* ── Slide-over panel ──────────────────────────────────────────────────── */

export function Panel({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  /*
   * Portalled to `document.body` on purpose, not just for stacking.
   *
   * Any button that opens one of these can itself be inside `Page`'s sticky
   * header (`app-shell.tsx`), which carries `backdrop-blur-xl` — a
   * `backdrop-filter`, and like `transform` or `filter` it makes that header
   * the containing block for every `position: fixed` descendant. Rendered in
   * place, "fixed inset-0" resolved against the header's own (short) box
   * instead of the viewport, so the drawer collapsed to header-height and the
   * header's `overflow-hidden` clipped everything below that — including the
   * footer, which is where every confirm/cancel button lives. It looked open,
   * the copy was readable, and the one thing you came for was gone.
   *
   * A portal renders outside that subtree entirely, so `fixed` is always
   * relative to the viewport regardless of what filter, transform or overflow
   * the trigger happens to sit inside. `mounted` exists only because
   * `document` does not exist during server rendering.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-scrim backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-[520px] flex-col border-l border-line bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] font-light text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-field-hover hover:text-fg"
          >
            <IconClose size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

        {footer && (
          <footer className="border-t border-line px-6 py-4">{footer}</footer>
        )}
      </div>
    </div>,
    document.body
  )
}
