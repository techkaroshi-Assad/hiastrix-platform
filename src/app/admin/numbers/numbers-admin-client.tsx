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
        "h-9 max-w-[220px] rounded-field border border-white/10 bg-white/[0.035] px-3 text-[12.5px] text-fg",
        "outline-none transition-colors hover:border-white/[0.16] focus:border-brand-500/65",
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
