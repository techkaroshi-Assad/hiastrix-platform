"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function SignOutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function signOut() {
    setLoading(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch {
      // Even if the call fails, send the user to sign in — never surface why.
    } finally {
      router.push("/login")
      router.refresh()
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={loading}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-muted transition-colors hover:bg-white/[0.03] hover:text-fg disabled:opacity-50"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-subtle">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
      {loading ? "Signing out…" : "Sign out"}
    </button>
  )
}
