"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { IconSignOut } from "@/components/app/icons"

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
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-muted transition-colors hover:bg-field hover:text-fg disabled:opacity-50"
    >
      <IconSignOut size={16} className="shrink-0 text-subtle" />
      {loading ? "Signing out…" : "Sign out"}
    </button>
  )
}
