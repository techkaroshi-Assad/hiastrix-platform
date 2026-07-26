"use client"

/**
 * Phone numbers — assignment control.
 *
 * Tenants can only ever see numbers Astrix has allocated to them; allocation
 * itself happens in the admin console, not here.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

export type NumberRow = {
  id: string
  phoneNumber: string
  status: "ACTIVE" | "INACTIVE"
  agentId: string | null
  agentName: string | null
  calls: number
}

export function NumberAssign({
  number,
  agents,
}: {
  number: NumberRow
  agents: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function assign(agentId: string) {
    setBusy(true)
    setError(null)
    try {
      // Assignment is expressed agent-side: PUT the number onto an agent, or
      // clear whatever agent currently holds it.
      const target = agentId || number.agentId
      if (!target) return

      const res = await fetch(`/api/agents/${target}/number`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId: agentId ? number.id : null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label={`Agent for ${number.phoneNumber}`}
        disabled={busy || agents.length === 0}
        value={number.agentId ?? ""}
        onChange={e => assign(e.target.value)}
        className={cn(
          "h-9 max-w-[200px] rounded-field border border-line-strong bg-field px-3 text-[12.5px] text-fg",
          "outline-none transition-colors hover:border-line-strong focus:border-brand-500/65",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        <option value="">{agents.length ? "Not assigned" : "No agents yet"}</option>
        {agents.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {error && <span className="text-[11.5px] text-danger">{error}</span>}
    </div>
  )
}
