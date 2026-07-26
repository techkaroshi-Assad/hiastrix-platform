"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"

/* ── Workspace name ────────────────────────────────────────────────────── */

export function CompanyForm({
  initial,
  canEdit,
}: {
  initial: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    setBusy(true)
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: value }),
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
      {done && <InfoNote>Workspace name updated.</InfoNote>}

      <Field
        label="Company name"
        value={value}
        onChange={e => setValue(e.target.value)}
        disabled={!canEdit || busy}
        minLength={2}
        maxLength={120}
        required
        hint={
          canEdit
            ? "This is the name shown across your workspace."
            : "Only the workspace owner can change this."
        }
      />

      {canEdit && (
        <SubmitButton
          type="submit"
          loading={busy}
          disabled={value.trim() === initial.trim() || value.trim().length < 2}
          sheen={false}
          className="w-auto px-5"
        >
          Save changes
        </SubmitButton>
      )}
    </form>
  )
}

/* ── Password ──────────────────────────────────────────────────────────── */

export function PasswordForm() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const mismatch = confirm.length > 0 && password !== confirm

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(null)

    if (password !== confirm) {
      setError("Those passwords don't match.")
      return
    }

    setBusy(true)
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setDone(body.message ?? "Your password has been updated.")
      setPassword("")
      setConfirm("")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 px-5 py-5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {done && <InfoNote>{done}</InfoNote>}

      <Field
        label="New password"
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        minLength={8}
        required
        autoComplete="new-password"
        hint="At least 8 characters."
      />
      <Field
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        minLength={8}
        required
        autoComplete="new-password"
        hint={mismatch ? "These don't match yet." : undefined}
      />

      <SubmitButton
        type="submit"
        loading={busy}
        disabled={password.length < 8 || password !== confirm}
        sheen={false}
        className="w-auto px-5"
      >
        Update password
      </SubmitButton>
    </form>
  )
}
