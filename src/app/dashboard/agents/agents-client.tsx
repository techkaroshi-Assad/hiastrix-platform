"use client"

/**
 * Agents — the list.
 *
 * All mutations go through our own /api/agents routes; this component never
 * talks to a provider directly and never sees an API key. Errors arriving from
 * those routes are already sanitised, so they are safe to render verbatim.
 *
 * The editor used to live here too, as a slide-over carrying about thirty
 * settings. It has moved to its own page — see agent-editor.tsx — because a
 * 520px column gave the system prompt the same weight as the interruption
 * threshold, and the two are not remotely equally important. What is left here
 * is the list, the on/off switch, number assignment and the test call.
 */

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { InfoNote } from "@/components/ui/field"
import { Select, SecondaryButton, DangerButton } from "@/components/ui/form"
import { EmptyState } from "@/components/app/app-shell"
import { IconAgents } from "@/components/app/icons"
import { labelFor, type Option } from "@/lib/vapi/options"
import { type AgentConfig } from "@/lib/vapi/config"
import { TestCallPanel } from "./test-call"
import { cn } from "@/lib/utils"

export type AgentRow = {
  id: string
  name: string
  status: "ACTIVE" | "INACTIVE"
  voice: string | null
  model: string | null
  systemPrompt: string | null
  firstMessage: string | null
  recordingEnabled: boolean
  transcriptionEnabled: boolean
  config: AgentConfig
  /** Every number routing to this agent. An agent may answer on several. */
  numbers: { id: string; phoneNumber: string }[]
  calls: number
  minutes: number
  avgSeconds: number
}

export type NumberRow = {
  id: string
  phoneNumber: string
  agentId: string | null
}

export function AgentsClient({
  agents,
  numbers,
  canCreate,
  lockedReason,
  browserCallEnabled,
  voices,
  models,
  transcribers,
}: {
  agents: AgentRow[]
  numbers: NumberRow[]
  canCreate: boolean
  lockedReason?: string
  browserCallEnabled: boolean
  /** Fetched live from the account — never hardcoded, since voices retire. */
  voices: Option[]
  models: Option[]
  transcribers: Option[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [testing, setTesting] = useState<AgentRow | null>(null)

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function toggleStatus(agent: AgentRow) {
    setRowBusy(agent.id)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: agent.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
        }),
      })
      if (res.ok) refresh()
    } finally {
      setRowBusy(null)
    }
  }

  /** `owner` is only for the busy indicator — detaching passes a null agentId,
   *  so the row still needs to know which card to grey out. */
  async function assignNumber(numberId: string, agentId: string | null, owner: string) {
    setRowBusy(owner)
    try {
      const res = await fetch(`/api/numbers/${numberId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      })
      if (res.ok) refresh()
    } finally {
      setRowBusy(null)
    }
  }

  async function remove(agent: AgentRow) {
    setRowBusy(agent.id)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" })
      if (res.ok) refresh()
    } finally {
      setRowBusy(null)
    }
  }

  return (
    <>
      {lockedReason && (
        <div className="mb-6">
          <InfoNote>{lockedReason}</InfoNote>
        </div>
      )}

      {agents.length === 0 ? (
        <EmptyState
          icon={<IconAgents />}
          title="No agents yet"
          body="An agent is the voice that answers or places your calls — its script, its personality, and the number it works from. Create one to get started."
          action={
            <NewAgentLink canCreate={canCreate} label="Create your first agent" />
          }
        />
      ) : (
        <div className="space-y-3">
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              numbers={numbers}
              voices={voices}
              models={models}
              busy={rowBusy === agent.id}
              editHref={`/dashboard/agents/${agent.id}`}
              onTest={() => setTesting(agent)}
              onToggle={() => toggleStatus(agent)}
              onAssign={(numberId, agentId) => assignNumber(numberId, agentId, agent.id)}
              onDelete={() => remove(agent)}
            />
          ))}
        </div>
      )}

      {agents.length > 0 && (
        <div className="mt-6 flex justify-end">
          <NewAgentLink canCreate={canCreate} label="New agent" />
        </div>
      )}

      {testing && (
        <TestCallPanel
          open
          onClose={() => setTesting(null)}
          agentId={testing.id}
          agentName={testing.name}
          browserCallEnabled={browserCallEnabled}
        />
      )}

    </>
  )
}

/* ── Card ──────────────────────────────────────────────────────────────── */

function AgentCard({
  agent,
  numbers,
  voices,
  models,
  busy,
  editHref,
  onTest,
  onToggle,
  onAssign,
  onDelete,
}: {
  agent: AgentRow
  numbers: NumberRow[]
  voices: Option[]
  models: Option[]
  busy: boolean
  editHref: string
  onTest: () => void
  onToggle: () => void
  onAssign: (numberId: string, agentId: string | null) => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const active = agent.status === "ACTIVE"

  const free = numbers.filter(n => n.agentId === null)

  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-field-soft p-5 transition-opacity",
        busy && "opacity-60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{agent.name}</h3>
            <StatusPill active={active} />
          </div>
          <p className="mt-1 text-[12.5px] text-subtle">
            {labelFor(voices, agent.voice)} · {labelFor(models, agent.model)}
            {agent.numbers.length > 0 && <> · {agent.numbers.map(n => n.phoneNumber).join(", ")}</>}
          </p>
          {/* An agent with no number looked identical to a live one. It can
              still be tested in the browser — it just cannot be rung. */}
          {agent.numbers.length === 0 && (
            <p className="mt-1 text-[12px] text-warning">
              No number yet — nobody can call this agent. You can still test it in
              your browser.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SecondaryButton onClick={onTest} disabled={busy || !active}>
            Test
          </SecondaryButton>
          <Link
            href={editHref}
            className="rounded-field border border-line bg-field px-3.5 py-2 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            Edit
          </Link>
          <SecondaryButton onClick={onToggle} disabled={busy}>
            {active ? "Disable" : "Enable"}
          </SecondaryButton>
        </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <Stat label="Calls" value={String(agent.calls)} />
        <Stat label="Minutes" value={String(agent.minutes)} />
        <Stat
          label="Avg duration"
          value={agent.avgSeconds > 0 ? formatDuration(agent.avgSeconds) : "—"}
        />
      </dl>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line-soft pt-4">
        <div className="w-full max-w-[380px] space-y-2">
          <span className="block text-xs font-medium text-muted">
            Numbers answering as this agent
          </span>

          {agent.numbers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {agent.numbers.map(n => (
                <button
                  key={n.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onAssign(n.id, null)}
                  title="Remove this number from the agent"
                  className={cn(
                    "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors",
                    "border-brand-500/60 bg-brand-500/12 text-brand-on-tint",
                    "hover:border-danger/60 hover:text-danger disabled:opacity-50"
                  )}
                >
                  {n.phoneNumber}
                  <span aria-hidden="true" className="opacity-60 group-hover:opacity-100">×</span>
                </button>
              ))}
            </div>
          )}

          {/* Only unassigned numbers are offered — taking one from another agent
              silently would be a surprise, and the other agent would go quiet. */}
          <Select
            label=""
            placeholder={free.length ? "Add a number…" : "No spare numbers"}
            options={free.map(n => ({ value: n.id, label: n.phoneNumber }))}
            value=""
            disabled={busy || free.length === 0}
            onChange={e => e.target.value && onAssign(e.target.value, agent.id)}
          />
        </div>

        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted">Delete this agent?</span>
            <SecondaryButton onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </SecondaryButton>
            <DangerButton onClick={onDelete} disabled={busy}>
              Delete
            </DangerButton>
          </div>
        ) : (
          <DangerButton onClick={() => setConfirming(true)} disabled={busy}>
            Delete
          </DangerButton>
        )}
      </div>
    </div>
  )
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        active ? "bg-success/12 text-success" : "bg-field-hover text-subtle"
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-success" : "bg-subtle")}
      />
      {active ? "Active" : "Disabled"}
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tracking-[-0.01em]">{value}</dd>
    </div>
  )
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}


/**
 * The one way into the editor. A disabled button that silently does nothing is
 * worse than one that says why, so the locked state carries the reason.
 */
function NewAgentLink({ canCreate, label }: { canCreate: boolean; label: string }) {
  if (!canCreate) {
    return (
      <span className="cursor-not-allowed rounded-field border border-line bg-field px-4 py-2.5 text-[13px] text-muted opacity-50">
        {label}
      </span>
    )
  }
  return (
    <Link
      href="/dashboard/agents/new"
      className="inline-flex items-center justify-center rounded-field bg-linear-to-b from-brand-400 to-brand-600 px-5 py-2.5 text-[13px] font-medium text-on-brand transition-opacity hover:opacity-90"
    >
      {label}
    </Link>
  )
}
