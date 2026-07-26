"use client"

import { useState } from "react"
import Link from "next/link"

export default function SignupPage() {
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    email: "",
    password: "",
  })
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSuccess("")
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

      setSuccess(data.message)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Hi-Astrix</h1>
          <p className="mt-1 text-sm text-zinc-400">Create your account</p>
        </div>

        {success ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-8 text-center">
            <div className="mb-3 text-2xl">✉️</div>
            <p className="text-sm text-zinc-300">{success}</p>
            <Link
              href="/login"
              className="mt-5 block text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-zinc-300">Full Name</label>
              <input
                type="text"
                name="name"
                required
                minLength={2}
                autoComplete="name"
                value={form.name}
                onChange={handleChange}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-zinc-300">Company Name</label>
              <input
                type="text"
                name="companyName"
                required
                minLength={2}
                autoComplete="organization"
                value={form.companyName}
                onChange={handleChange}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                placeholder="Acme Corp"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-zinc-300">Work Email</label>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={handleChange}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-zinc-300">Password</label>
              <input
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={handleChange}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                placeholder="Min. 8 characters"
              />
            </div>

            {error && (
              <p className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-white py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-100 disabled:opacity-50"
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>
        )}

        {!success && (
          <p className="mt-6 text-center text-sm text-zinc-500">
            Already have an account?{" "}
            <Link href="/login" className="text-zinc-300 transition-colors hover:text-white">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
