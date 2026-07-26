"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote } from "@/components/ui/field"

export function AcceptForm({
  token,
  email,
  initialName,
}: {
  token: string
  email: string
  initialName: string
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirm.length > 0 && password !== confirm
  const valid = name.trim().length >= 2 && password.length >= 8 && password === confirm

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      router.push(body.redirect ?? "/dashboard")
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Field label="Email" value={email} readOnly disabled />

      <Field
        label="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        minLength={2}
        required
        autoComplete="name"
      />

      <Field
        label="Choose a password"
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        minLength={8}
        required
        autoComplete="new-password"
        hint="At least 8 characters."
      />

      <Field
        label="Confirm password"
        type="password"
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        minLength={8}
        required
        autoComplete="new-password"
        hint={mismatch ? "These don't match yet." : undefined}
      />

      <SubmitButton type="submit" loading={busy} disabled={!valid}>
        Join the workspace
      </SubmitButton>
    </form>
  )
}
