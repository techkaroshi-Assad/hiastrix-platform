"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SecondaryButton } from "@/components/ui/form"
import { ErrorNote, InfoNote } from "@/components/ui/field"
import { cn } from "@/lib/utils"

export function SyncButton() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function sync() {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch("/api/admin/numbers", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setNote(
        body.added > 0
          ? `Synced ${body.total} numbers — ${body.added} new.`
          : `Synced ${body.total} numbers. Nothing new.`
      )
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <SecondaryButton onClick={sync} disabled={busy}>
        {busy ? "Syncing…" : "Sync inventory"}
      </SecondaryButton>
      {note && <InfoNote>{note}</InfoNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}

/**
 * How many calls this number may place in a rolling 24 hours.
 *
 * Blank means "use the platform default", which is the honest way to say
 * it: most numbers should inherit, and only the ones with a reason — a
 * tenant's own purchased number, a number being warmed up — carry a figure
 * of their own. Saves on blur or Enter rather than per keystroke.
 */
export function DailyCapInput({
  numberId,
  value,
  platformDefault,
}: {
  numberId: string
  value: number | null
  platformDefault: number
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [text, setText] = useState(value === null ? "" : String(value))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function save() {
    const trimmed = text.trim()
    const next = trimmed === "" ? null : Math.round(Number(trimmed))
    if (next !== null && (!Number.isFinite(next) || next < 1 || next > 5000)) {
      setError(true)
      return
    }
    if (next === value) return
    setError(false)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/numbers/${numberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyCallCap: next }),
      })
      if (!res.ok) {
        setError(true)
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <input
      type="number"
      min={1}
      max={5000}
      inputMode="numeric"
      aria-label="Calls per day for this number"
      placeholder={String(platformDefault)}
      disabled={busy}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={save}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") setText(value === null ? "" : String(value))
      }}
      className={cn(
        "h-9 w-[92px] rounded-field border bg-field px-2.5 text-right text-[12.5px] tabular-nums text-fg",
        "outline-none transition-colors focus:border-brand-500/65",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error ? "border-danger" : "border-line-strong hover:border-line-strong"
      )}
    />
  )
}

export function AllocateSelect({
  numberId,
  tenantId,
  tenants,
}: {
  numberId: string
  tenantId: string | null
  tenants: { id: string; companyName: string }[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  async function allocate(next: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/numbers/${numberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: next === "" ? null : next }),
      })
      if (res.ok) startTransition(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  return (
    <select
      aria-label="Allocate to tenant"
      disabled={busy}
      value={tenantId ?? ""}
      onChange={e => allocate(e.target.value)}
      className={cn(
        "h-9 max-w-[220px] rounded-field border border-line-strong bg-field px-3 text-[12.5px] text-fg",
        "outline-none transition-colors hover:border-line-strong focus:border-brand-500/65",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      <option value="">Unallocated</option>
      {tenants.map(t => (
        <option key={t.id} value={t.id}>
          {t.companyName}
        </option>
      ))}
    </select>
  )
}
