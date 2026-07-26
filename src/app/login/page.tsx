"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AuthSplit, AuthLink } from "@/components/auth/auth-shell"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"

function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [error,    setError]    = useState("")
  const [info,     setInfo]     = useState("")
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    if (searchParams.get("updated"))             setInfo("Your password has been updated. Please sign in.")
    if (searchParams.get("error") === "link_expired") setError("That link has expired. Please request a new one.")
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setInfo("")
    setLoading(true)

    try {
      const res  = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.")
        return
      }

      router.push(data.redirectTo)
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthSplit
      title="Welcome back"
      subtitle="Sign in to your workspace"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <AuthLink href="/signup">Create one</AuthLink>
        </>
      }
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

        <Field
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        {info  && <InfoNote>{info}</InfoNote>}
        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="pt-1">
          <SubmitButton type="submit" loading={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </SubmitButton>
        </div>
      </form>

      <div className="mt-5 text-center text-[13px]">
        <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
      </div>
    </AuthSplit>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ink" />}>
      <LoginForm />
    </Suspense>
  )
}
