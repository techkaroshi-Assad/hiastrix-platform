"use client"

import { forwardRef, useId, useState } from "react"
import { cn } from "@/lib/utils"
import { IconShow, IconHide, IconSpinner, IconInfo, IconAlert } from "@/components/app/icons"

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

const Eye    = () => <IconShow size={16} strokeWidth={1.8} />
const EyeOff = () => <IconHide size={16} strokeWidth={1.8} />

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
    <IconSpinner
      size={16}
      strokeWidth={2.5}
      aria-hidden="true"
      className="relative animate-spin"
    />
  )
}

/* ── Inline messages ───────────────────────────────────────────────────── */

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-field border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
    >
      <IconAlert size={16} strokeWidth={1.9} aria-hidden="true" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-field border border-brand-500/25 bg-brand-500/10 px-3.5 py-2.5 text-[13px] text-brand-on-tint">
      <IconInfo size={16} strokeWidth={1.9} aria-hidden="true" className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}
