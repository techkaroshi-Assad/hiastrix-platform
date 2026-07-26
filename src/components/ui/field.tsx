"use client"

import { forwardRef, useId, useState } from "react"
import { cn } from "@/lib/utils"

/* ── Text field ────────────────────────────────────────────────────────── */

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, className, id, type, ...props },
  ref
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const [reveal, setReveal] = useState(false)
  const isPassword = type === "password"

  return (
    <div className="space-y-2">
      <label
        htmlFor={fieldId}
        className="block text-xs font-medium tracking-[0.01em] text-muted"
      >
        {label}
      </label>

      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          type={isPassword && reveal ? "text" : type}
          className={cn(
            "h-11 w-full rounded-field bg-field px-3.5 text-sm text-fg",
            "border border-line-strong placeholder:text-subtle",
            "transition-[border-color,box-shadow] duration-200 outline-none",
            "hover:border-brand-400/45",
            "focus:border-brand-500/65 focus:shadow-[0_0_0_3.5px_rgba(124,92,255,0.16)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            isPassword && "pr-11",
            className
          )}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal(v => !v)}
            tabIndex={-1}
            aria-label={reveal ? "Hide password" : "Show password"}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-subtle transition-colors hover:text-muted"
          >
            {reveal ? <EyeOff /> : <Eye />}
          </button>
        )}
      </div>

      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  )
})

function Eye() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.4 3.2M6.2 6.4A17 17 0 0 0 2 12s3.5 7 10 7a9.9 9.9 0 0 0 4.3-1" />
      <path d="m3 3 18 18" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

/* ── Primary button ────────────────────────────────────────────────────── */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  /** Adds the slow travelling highlight. Off inside dense UI. */
  sheen?: boolean
}

export function SubmitButton({
  children,
  loading,
  sheen = true,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden",
        "rounded-field text-[13.5px] font-semibold tracking-[-0.005em] text-on-brand",
        "bg-linear-to-b from-brand-400 to-brand-600",
        "shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_8px_22px_-6px_rgba(124,92,255,0.60)]",
        "transition-[transform,filter,opacity] duration-200",
        "hover:brightness-110 active:scale-[0.985]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100 disabled:active:scale-100",
        className
      )}
    >
      {sheen && !loading && !disabled && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-sheen"
          style={{
            background:
              "linear-gradient(105deg, transparent 30%, rgba(255,255,255,.30) 50%, transparent 70%)",
          }}
        />
      )}
      {loading && <Spinner />}
      <span className="relative">{children}</span>
    </button>
  )
}

function Spinner() {
  return (
    <svg className="relative h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/* ── Inline messages ───────────────────────────────────────────────────── */

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-field border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
    >
      <svg className="mt-px h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4.5M12 16h.01" />
      </svg>
      <span>{children}</span>
    </p>
  )
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-field border border-brand-500/25 bg-brand-500/10 px-3.5 py-2.5 text-[13px] text-brand-200">
      <svg className="mt-px h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4.5M12 8h.01" />
      </svg>
      <span>{children}</span>
    </p>
  )
}
