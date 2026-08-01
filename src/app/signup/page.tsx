"use client"

import { useState } from "react"
import { AuthSplit, AuthLink } from "@/components/auth/auth-shell"
import { Field, SubmitButton, ErrorNote } from "@/components/ui/field"
import { IconMail } from "@/components/app/icons"

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", companyName: "", email: "", password: "" })
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.")
        return
      }

      setSuccess(data.message ?? "Check your inbox to confirm your email address.")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthSplit title="Check your inbox" subtitle={`We sent a confirmation link to ${form.email}`}>
        <div className="rounded-card border border-line-strong bg-field px-6 py-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/12 text-brand-300">
            <IconMail size={22} />
          </div>
          <p className="mt-4 text-sm font-light leading-relaxed text-muted">{success}</p>
        </div>

        <div className="mt-6 text-center text-[13px] text-subtle">
          Already confirmed? <AuthLink href="/login">Sign in</AuthLink>
        </div>
      </AuthSplit>
    )
  }

  return (
    <AuthSplit
      title="Create your account"
      subtitle="Set up your workspace in under a minute"
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Full name"
          name="name"
          required
          minLength={2}
          autoComplete="name"
          placeholder="Jane Cooper"
          value={form.name}
          onChange={handleChange}
        />

        <Field
          label="Company"
          name="companyName"
          required
          minLength={2}
          autoComplete="organization"
          placeholder="Acme Inc."
          value={form.companyName}
          onChange={handleChange}
        />

        <Field
          label="Work email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="jane@acme.com"
          value={form.email}
          onChange={handleChange}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={form.password}
          onChange={handleChange}
        />

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="pt-1">
          <SubmitButton type="submit" loading={loading}>
            {loading ? "Creating account…" : "Create account"}
          </SubmitButton>
        </div>

        <p className="pt-1 text-center text-[11.5px] font-light leading-relaxed text-subtle">
          By creating an account you agree to our{" "}
          <AuthLink href="/terms">Terms</AuthLink> and{" "}
          <AuthLink href="/privacy">Privacy Policy</AuthLink>.
        </p>
      </form>
    </AuthSplit>
  )
}
