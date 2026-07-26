"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"

export function PlatformSettingsForm({
  overageRateCents,
  lowBalancePct,
  supportEmail,
  canEdit,
}: {
  overageRateCents: number
  lowBalancePct: number
  supportEmail: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [rate, setRate]       = useState((overageRateCents / 100).toFixed(2))
  const [pct, setPct]         = useState(String(lowBalancePct))
  const [email, setEmail]     = useState(supportEmail)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState(false)

  const dirty =
    Math.round(Number(rate) * 100) !== overageRateCents ||
    Number(pct) !== lowBalancePct ||
    email !== supportEmail

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    setBusy(true)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overageRateCents: Math.round(Number(rate) * 100),
          lowBalancePct:    Math.round(Number(pct)),
          supportEmail:     email.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setDone(true)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 px-5 py-5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {done && <InfoNote>Settings saved.</InfoNote>}

      <Field
        label="Default overage rate (USD per minute)"
        type="number" min={0} step="0.01"
        value={rate}
        onChange={e => setRate(e.target.value)}
        disabled={!canEdit || busy}
        hint="Applied to newly created packages. Existing packages keep the rate they were created with, so changing this never reprices a live tenant."
      />

      <Field
        label="Low balance warning (% of package value)"
        type="number" min={1} max={90}
        value={pct}
        onChange={e => setPct(e.target.value)}
        disabled={!canEdit || busy}
        hint="Tenants are emailed once when their balance first drops below this share of their package price."
      />

      <Field
        label="Support email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        disabled={!canEdit || busy}
        hint="Shown to tenants when they need to reach a human."
      />

      {canEdit ? (
        <SubmitButton
          type="submit"
          loading={busy}
          disabled={!dirty}
          sheen={false}
          className="w-auto px-5"
        >
          Save settings
        </SubmitButton>
      ) : (
        <p className="text-xs text-subtle">Only a super admin can change these.</p>
      )}
    </form>
  )
}
