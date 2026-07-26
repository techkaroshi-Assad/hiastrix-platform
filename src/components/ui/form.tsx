"use client"

/**
 * Form controls for the signed-in app.
 *
 * Kept separate from `ui/field.tsx` (which serves the auth screens) so
 * dashboard-only controls can evolve without risking the login and signup
 * flows. Styling mirrors Field so the two read as one system.
 */

import { forwardRef, useId, useState } from "react"
import { cn } from "@/lib/utils"

const CONTROL = [
  "w-full rounded-field bg-white/[0.035] text-sm text-fg",
  "border border-white/10 placeholder:text-subtle",
  "transition-[border-color,box-shadow] duration-200 outline-none",
  "hover:border-white/[0.16]",
  "focus:border-brand-500/65 focus:shadow-[0_0_0_3.5px_rgba(124,92,255,0.16)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ")

/* ── Label wrapper ─────────────────────────────────────────────────────── */

function Shell({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-medium tracking-[0.01em] text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-subtle">{hint}</p>}
    </div>
  )
}

/* ── Textarea ──────────────────────────────────────────────────────────── */

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  hint?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ label, hint, className, id, rows = 5, ...props }, ref) {
    const autoId = useId()
    const fieldId = id ?? autoId
    return (
      <Shell id={fieldId} label={label} hint={hint}>
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
  options: { value: string; label: string; note?: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, options, placeholder, className, id, ...props },
  ref
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Shell id={fieldId} label={label} hint={hint}>
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
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
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
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-start justify-between gap-4 rounded-field border px-3.5 py-3 text-left transition-colors",
        "border-white/10 hover:border-white/[0.16]",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-fg">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-subtle">{description}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-brand-500" : "bg-white/15"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
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
        "border border-white/[0.12] bg-white/[0.04] text-[13px] font-medium text-fg",
        "transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.07]",
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
    <div className="overflow-hidden rounded-field border border-white/[0.08]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-fg">{title}</span>
          {description && (
            <span className="mt-0.5 block text-xs leading-relaxed text-subtle">
              {description}
            </span>
          )}
        </span>
        <svg
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-subtle transition-transform duration-200",
            open && "rotate-180"
          )}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && <div className="space-y-4 border-t border-white/[0.06] px-4 py-4">{children}</div>}
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
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-[520px] flex-col border-l border-white/[0.08] bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] font-light text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-white/[0.06] hover:text-fg"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

        {footer && (
          <footer className="border-t border-white/[0.07] px-6 py-4">{footer}</footer>
        )}
      </div>
    </div>
  )
}
