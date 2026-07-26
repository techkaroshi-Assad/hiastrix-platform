"use client"

/**
 * Agents — interactive layer.
 *
 * All mutations go through our own /api/agents routes; this component never
 * talks to a provider directly and never sees an API key. Errors arriving from
 * those routes are already sanitised, so they are safe to render verbatim.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import {
  TextArea,
  Select,
  Toggle,
  Panel,
  SecondaryButton,
  DangerButton,
} from "@/components/ui/form"
import { EmptyState } from "@/components/app/app-shell"
import { IconAgents } from "@/components/app/icons"
import { VOICES, MODELS, DEFAULT_VOICE, DEFAULT_MODEL, labelFor } from "@/lib/vapi/options"
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
  phoneNumberId: string | null
  phoneNumberLabel: string | null
  calls: number
  minutes: number
  avgSeconds: number
}

export type NumberRow = {
  id: string
  phoneNumber: string
  agentId: string | null
}

type Draft = {
  name: string
  systemPrompt: string
  firstMessage: string
  voice: string
  model: string
  recordingEnabled: boolean
  transcriptionEnabled: boolean
}

const BLANK: Draft = {
  name: "",
  systemPrompt:
    "You are a helpful, concise voice assistant. Speak naturally, keep answers short, and ask clarifying questions when a request is ambiguous.",
  firstMessage: "Hi, thanks for calling. How can I help you today?",
  voice: DEFAULT_VOICE,
  model: DEFAULT_MODEL,
  recordingEnabled: true,
  transcriptionEnabled: true,
}

export function AgentsClient({
  agents,
  numbers,
  canCreate,
  lockedReason,
}: {
  agents: AgentRow[]
  numbers: NumberRow[]
  canCreate: boolean
  lockedReason?: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<AgentRow | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  function refresh() {
    startTransition(() => router.refresh())
  }

  function openCreate() {
    setEditing(null)
    setDraft(BLANK)
    setError(null)
    setPanelOpen(true)
  }

  function openEdit(agent: AgentRow) {
    setEditing(agent)
    setDraft({
      name:                 agent.name,
      systemPrompt:         agent.systemPrompt ?? "",
      firstMessage:         agent.firstMessage ?? "",
      voice:                agent.voice ?? DEFAULT_VOICE,
      model:                agent.model ?? DEFAULT_MODEL,
      recordingEnabled:     agent.recordingEnabled,
      transcriptionEnabled: agent.transcriptionEnabled,
    })
    setError(null)
    setPanelOpen(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(
        editing ? `/api/agents/${editing.id}` : "/api/agents",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setPanelOpen(false)
      refresh()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
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

  async function assignNumber(agent: AgentRow, phoneNumberId: string | null) {
    setRowBusy(agent.id)
    try {
      const res = await fetch(`/api/agents/${agent.id}/number`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId }),
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
            <SecondaryButton onClick={openCreate} disabled={!canCreate}>
              Create your first agent
            </SecondaryButton>
          }
        />
      ) : (
        <div className="space-y-3">
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              numbers={numbers}
              busy={rowBusy === agent.id}
              onEdit={() => openEdit(agent)}
              onToggle={() => toggleStatus(agent)}
              onAssign={id => assignNumber(agent, id)}
              onDelete={() => remove(agent)}
            />
          ))}
        </div>
      )}

      <Panel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={editing ? "Edit agent" : "New agent"}
        subtitle={
          editing
            ? "Changes take effect on the next call."
            : "Give your agent a script and a voice. You can refine it any time."
        }
        footer={
          <div className="flex items-center justify-end gap-3">
            <SecondaryButton type="button" onClick={() => setPanelOpen(false)} disabled={busy}>
              Cancel
            </SecondaryButton>
            <SubmitButton
              form="agent-form"
              type="submit"
              loading={busy}
              sheen={false}
              className="w-auto px-5"
            >
              {editing ? "Save changes" : "Create agent"}
            </SubmitButton>
          </div>
        }
      >
        <form id="agent-form" onSubmit={save} className="space-y-5">
          {error && <ErrorNote>{error}</ErrorNote>}

          <Field
            label="Agent name"
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder="Front desk receptionist"
            required
            minLength={2}
            maxLength={60}
          />

          <TextArea
            label="First message"
            value={draft.firstMessage}
            onChange={e => setDraft({ ...draft, firstMessage: e.target.value })}
            rows={2}
            required
            maxLength={1000}
            hint="The first thing the caller hears when the agent picks up."
          />

          <TextArea
            label="System prompt"
            value={draft.systemPrompt}
            onChange={e => setDraft({ ...draft, systemPrompt: e.target.value })}
            rows={8}
            required
            minLength={10}
            maxLength={8000}
            hint="The agent's instructions — its role, tone, what it knows, and what it must never do."
          />

          <Select
            label="Voice"
            options={VOICES}
            value={draft.voice}
            onChange={e => setDraft({ ...draft, voice: e.target.value })}
          />

          <Select
            label="Language model"
            options={MODELS}
            value={draft.model}
            onChange={e => setDraft({ ...draft, model: e.target.value })}
            hint="Faster models cost less per minute and respond more quickly."
          />

          <div className="space-y-2.5">
            <Toggle
              label="Record calls"
              description="Store an audio recording you can play back from the call log."
              checked={draft.recordingEnabled}
              onChange={v => setDraft({ ...draft, recordingEnabled: v })}
            />
            <Toggle
              label="Transcribe calls"
              description="Produce a written transcript alongside each recording."
              checked={draft.transcriptionEnabled}
              onChange={v => setDraft({ ...draft, transcriptionEnabled: v })}
            />
          </div>
        </form>
      </Panel>

      {agents.length > 0 && (
        <div className="mt-6 flex justify-end">
          <SecondaryButton onClick={openCreate} disabled={!canCreate}>
            <span aria-hidden="true">+</span> New agent
          </SecondaryButton>
        </div>
      )}
    </>
  )
}

/* ── Card ──────────────────────────────────────────────────────────────── */

function AgentCard({
  agent,
  numbers,
  busy,
  onEdit,
  onToggle,
  onAssign,
  onDelete,
}: {
  agent: AgentRow
  numbers: NumberRow[]
  busy: boolean
  onEdit: () => void
  onToggle: () => void
  onAssign: (phoneNumberId: string | null) => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const active = agent.status === "ACTIVE"

  // A number is selectable if it is unassigned, or already on this agent.
  const selectable = numbers.filter(n => n.agentId === null || n.agentId === agent.id)

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 transition-opacity",
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
            {labelFor(VOICES, agent.voice)} · {labelFor(MODELS, agent.model)}
            {agent.phoneNumberLabel && <> · {agent.phoneNumberLabel}</>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <SecondaryButton onClick={onEdit} disabled={busy}>
            Edit
          </SecondaryButton>
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

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-white/[0.05] pt-4">
        <div className="w-full max-w-[280px]">
          <Select
            label="Phone number"
            placeholder={selectable.length ? "Not assigned" : "None allocated yet"}
            options={selectable.map(n => ({ value: n.id, label: n.phoneNumber }))}
            value={agent.phoneNumberId ?? ""}
            disabled={busy || selectable.length === 0}
            onChange={e => onAssign(e.target.value === "" ? null : e.target.value)}
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
        active ? "bg-success/12 text-success" : "bg-white/[0.06] text-subtle"
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
