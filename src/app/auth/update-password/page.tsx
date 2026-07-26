"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AuthShell, AuthLink } from "@/components/auth/auth-shell"
import { Field, SubmitButton, ErrorNote } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/** Cheap, honest strength read — length, case mix, digits, symbols. */
function scorePassword(pw: string) {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^\w\s]/.test(pw)) score++
  return Math.min(score, 4)
}

const STRENGTH = [
  { label: "", color: "" },
  { label: "Weak", color: "bg-danger" },
  { label: "Fair", color: "bg-warning" },
  { label: "Good", color: "bg-brand-400" },
  { label: "Strong", color: "bg-success" },
]

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const score = useMemo(() => scorePassword(password), [password])
  const mismatch = confirm.length > 0 && password !== confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password !== confirm) {
      setError("Those passwords don't match.")
      return
    }

    setLoading(true)

    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.")
        return
      }

      router.push("/login?updated=1")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose something you haven't used before"
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Field
            label="New password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />

          {password && (
            <div className="mt-2.5 flex items-center gap-2.5">
              <div className="flex flex-1 gap-1">
                {[1, 2, 3, 4].map(i => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors duration-300",
                      i <= score ? STRENGTH[score].color : "bg-white/10"
                    )}
                  />
                ))}
              </div>
              <span className="w-11 text-right text-[11px] text-subtle">
                {STRENGTH[score].label}
              </span>
            </div>
          )}
        </div>

        <Field
          label="Confirm password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className={cn(mismatch && "border-danger/50 focus:border-danger/70")}
        />

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="pt-1">
          <SubmitButton type="submit" loading={loading} disabled={mismatch || password.length < 8}>
            {loading ? "Updating…" : "Update password"}
          </SubmitButton>
        </div>
      </form>
    </AuthShell>
  )
}
