"use client"

import { useState } from "react"
import { AuthShell, AuthLink } from "@/components/auth/auth-shell"
import { Field, SubmitButton } from "@/components/ui/field"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState("")
  const [loading, setLoading] = useState(false)

  const GENERIC = "If that email is registered, you'll receive a reset link shortly."

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      setSent(data.message ?? GENERIC)
    } catch {
      // Same message on failure — never reveal whether the address exists
      setSent(GENERIC)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your inbox" subtitle="Follow the link to set a new password">
        <div className="rounded-card border border-line-strong bg-field px-6 py-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/12 text-brand-300">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="5" width="19" height="14" rx="3" />
              <path d="m3 7 8.2 5.6a1.5 1.5 0 0 0 1.6 0L21 7" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-light leading-relaxed text-muted">{sent}</p>
        </div>

        <div className="mt-6 text-center text-[13px]">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a secure link"
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <div className="pt-1">
          <SubmitButton type="submit" loading={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </SubmitButton>
        </div>
      </form>
    </AuthShell>
  )
}
