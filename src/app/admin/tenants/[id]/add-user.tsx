"use client"

/**
 * Add an account manager to a tenant.
 *
 * The temporary password is generated here and emailed to them; it is shown
 * once on screen in case email delivery isn't configured yet, then cleared.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { SecondaryButton } from "@/components/ui/form"

function generatePassword() {
  // Ambiguous glyphs (0/O, 1/l/I) left out so it survives being read aloud.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = new Uint32Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, n => alphabet[n % alphabet.length]).join("")
}

export function AddAccountManager({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [open, setOpen]   = useState(false)
  const [name, setName]   = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState(generatePassword)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone]   = useState<string | null>(null)

  const valid = name.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && password.length >= 10

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setDone(`${name.trim()} can now sign in. Their temporary password is ${password}`)
      setName("")
      setEmail("")
      setPassword(generatePassword())
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="border-t border-white/[0.06] px-5 py-4">
        {done && (
          <div className="mb-3">
            <InfoNote>{done}</InfoNote>
          </div>
        )}
        <SecondaryButton onClick={() => setOpen(true)}>Add account manager</SecondaryButton>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4 border-t border-white/[0.06] px-5 py-5">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Field
        label="Full name"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Priya Sharma"
        minLength={2}
        required
      />
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="priya@astrixdigitalmedia.com"
        required
      />
      <Field
        label="Temporary password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        minLength={10}
        required
        hint="Emailed to them along with a sign-in link. They can change it from Settings."
      />

      <div className="flex items-center gap-3">
        <SubmitButton
          type="submit"
          loading={busy}
          disabled={!valid}
          sheen={false}
          className="w-auto px-5"
        >
          Create login
        </SubmitButton>
        <SecondaryButton type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </SecondaryButton>
      </div>
    </form>
  )
}
