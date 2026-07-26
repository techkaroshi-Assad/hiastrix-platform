"use client"

import { useState } from "react"
import Link from "next/link"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

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
      setMessage(data.message ?? "If that email is registered, you'll receive a reset link shortly.")
    } catch {
      setMessage("If that email is registered, you'll receive a reset link shortly.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Hi-Astrix</h1>
          <p className="mt-1 text-sm text-zinc-400">Reset your password</p>
        </div>

        {message ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-8 text-center">
            <p className="text-sm text-zinc-300">{message}</p>
            <Link
              href="/login"
              className="mt-5 block text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm text-zinc-400">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-zinc-300">Email address</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                  placeholder="you@company.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-white py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm">
              <Link href="/login" className="text-zinc-500 transition-colors hover:text-zinc-300">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
