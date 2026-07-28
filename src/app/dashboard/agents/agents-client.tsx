"use client"

/**
 * Agents — interactive layer.
 *
 * All mutations go through our own /api/agents routes; this component never
 * talks to a provider directly and never sees an API key. Errors arriving from
 * those routes are already sanitised, so they are safe to render verbatim.
 *
 * The builder exposes Vapi's full assistant surface. Only the five fields that
 * matter for a first agent are open by default; everything else lives behind a
 * disclosure so the form stays approachable.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import {
  TextArea,
  Select,
  Toggle,
  Panel,
  Section,
  SecondaryButton,
  DangerButton,
} from "@/components/ui/form"
import { EmptyState } from "@/components/app/app-shell"
import { IconAgents } from "@/components/app/icons"
import { labelFor, type Option } from "@/lib/vapi/options"
import {
  DEFAULT_CONFIG,
  FIRST_MESSAGE_MODES,
  BACKGROUND_SOUNDS,
  LANGUAGES,
  type AgentConfig,
} from "@/lib/vapi/config"
import { ToolsEditor } from "@/components/agents/tools-editor"
import { JsonEditor } from "@/components/agents/json-editor"
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

type Draft = {
  name: string
  systemPrompt: string
  firstMessage: string
  voice: string
  model: string
  recordingEnabled: boolean
  transcriptionEnabled: boolean
  config: AgentConfig
}

function blankDraft(voices: Option[], models: Option[]): Draft {
  return {
    name: "",
    systemPrompt:
      "You are a helpful, concise voice assistant. Speak naturally, keep answers short, and ask clarifying questions when a request is ambiguous.",
    firstMessage: "Hi, thanks for calling. How can I help you today?",
    // Defaults come from the live catalogue so a retired voice can never be
    // pre-selected into a new agent.
    voice: voices[0]?.value ?? "",
    model: models.find(m => m.value.endsWith("mini"))?.value ?? models[0]?.value ?? "",
    recordingEnabled: true,
    transcriptionEnabled: true,
    config: DEFAULT_CONFIG,
  }
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

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<AgentRow | null>(null)
  const [draft, setDraft] = useState<Draft>(() => blankDraft(voices, models))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [testing, setTesting] = useState<AgentRow | null>(null)
  const [tab, setTab] = useState<"form" | "json">("form")
  // A malformed JSON draft must not be submittable, and must not be silently
  // dropped by switching tabs either.
  const [jsonValid, setJsonValid] = useState(true)

  const setConfig = (patch: Partial<AgentConfig>) =>
    setDraft(d => ({ ...d, config: { ...d.config, ...patch } }))

  function refresh() {
    startTransition(() => router.refresh())
  }

  function openCreate() {
    setTab("form")
    setJsonValid(true)
    setEditing(null)
    setDraft(blankDraft(voices, models))
    setError(null)
    setPanelOpen(true)
  }

  function openEdit(agent: AgentRow) {
    setTab("form")
    setJsonValid(true)
    setEditing(agent)
    setDraft({
      name:                 agent.name,
      systemPrompt:         agent.systemPrompt ?? "",
      firstMessage:         agent.firstMessage ?? "",
      voice:                agent.voice ?? voices[0]?.value ?? "",
      model:                agent.model ?? models[0]?.value ?? "",
      recordingEnabled:     agent.recordingEnabled,
      transcriptionEnabled: agent.transcriptionEnabled,
      config:               { ...DEFAULT_CONFIG, ...agent.config },
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

  const c = draft.config

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
              voices={voices}
              models={models}
              busy={rowBusy === agent.id}
              onEdit={() => openEdit(agent)}
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
          <SecondaryButton onClick={openCreate} disabled={!canCreate}>
            <span aria-hidden="true">+</span> New agent
          </SecondaryButton>
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

      <Panel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={editing ? "Edit agent" : "New agent"}
        subtitle={
          editing
            ? "Changes take effect on the next call."
            : "Give your agent a script and a voice. Everything else has a sensible default."
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
              disabled={!jsonValid}
              sheen={false}
              className="w-auto px-5"
            >
              {editing ? "Save changes" : "Create agent"}
            </SubmitButton>
          </div>
        }
      >
        <div className="mb-5 flex gap-2">
          <SecondaryButton
            type="button"
            onClick={() => setTab("form")}
            disabled={!jsonValid}
            className={cn(tab === "form" && "border-brand-500/60 bg-brand-500/12 text-brand-on-tint")}
          >
            Form
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={() => setTab("json")}
            className={cn(tab === "json" && "border-brand-500/60 bg-brand-500/12 text-brand-on-tint")}
          >
            JSON
          </SecondaryButton>
        </div>

        {tab === "json" && (
          <JsonEditor
            key={editing?.id ?? "new"}
            draft={draft}
            onChange={setDraft}
            onValidityChange={setJsonValid}
          />
        )}

        <form
          id="agent-form"
          onSubmit={save}
          className={cn("space-y-5", tab === "json" && "hidden")}
        >
          {error && <ErrorNote>{error}</ErrorNote>}

          {/* ── Essentials ─────────────────────────────────────────── */}
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
            options={voices}
            value={draft.voice}
            onChange={e => setDraft({ ...draft, voice: e.target.value })}
          />

          <Select
            label="Language model"
            options={models}
            value={draft.model}
            onChange={e => setDraft({ ...draft, model: e.target.value })}
            hint="Faster models cost less per minute and respond more quickly."
          />

          {/* ── Conversation ───────────────────────────────────────── */}
          <Section
            title="Conversation"
            description="How the call opens and how creative the model is."
          >
            <Select
              label="Opening behaviour"
              options={FIRST_MESSAGE_MODES.map(m => ({ ...m }))}
              value={c.firstMessageMode}
              onChange={e => setConfig({ firstMessageMode: e.target.value as AgentConfig["firstMessageMode"] })}
            />
            <Toggle
              label="Caller can interrupt the greeting"
              description="Let the caller talk over the first message instead of waiting."
              checked={c.firstMessageInterruptionsEnabled}
              onChange={v => setConfig({ firstMessageInterruptionsEnabled: v })}
            />
            <Field
              label="Temperature"
              type="number" min={0} max={2} step="0.1"
              value={String(c.temperature)}
              onChange={e => setConfig({ temperature: Number(e.target.value) })}
              hint="0 is deterministic and repetitive, 1 is natural, above 1 gets unpredictable."
            />
            <Field
              label="Max response tokens"
              type="number" min={50} max={4000} step="10"
              value={String(c.maxTokens)}
              onChange={e => setConfig({ maxTokens: Number(e.target.value) })}
              hint="Caps how long each reply can be. Lower keeps the agent snappy."
            />
          </Section>

          {/* ── Speech ─────────────────────────────────────────────── */}
          <Section
            title="Speech and language"
            description="Transcription engine, language, recording."
          >
            <Select
              label="Transcription engine"
              options={transcribers}
              value={c.transcriber}
              onChange={e => setConfig({ transcriber: e.target.value })}
            />
            <Select
              label="Language"
              options={LANGUAGES.map(l => ({ ...l }))}
              value={c.language}
              onChange={e => setConfig({ language: e.target.value })}
            />
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
          </Section>

          {/* ── Call control ───────────────────────────────────────── */}
          <Section
            title="Call control"
            description="Limits, sign-off, and when the agent hangs up."
          >
            <Field
              label="Maximum call length (seconds)"
              type="number" min={30} max={43200}
              value={String(c.maxDurationSeconds)}
              onChange={e => setConfig({ maxDurationSeconds: Number(e.target.value) })}
              hint="Hard cap. Protects you from a runaway call burning minutes."
            />
            <Field
              label="Silence timeout (seconds)"
              type="number" min={10} max={3600}
              value={String(c.silenceTimeoutSeconds)}
              onChange={e => setConfig({ silenceTimeoutSeconds: Number(e.target.value) })}
              hint="Hang up after this much silence from the caller."
            />
            <TextArea
              label="Sign-off message"
              rows={2}
              value={c.endCallMessage}
              onChange={e => setConfig({ endCallMessage: e.target.value })}
              maxLength={1000}
              hint="Spoken just before the agent ends the call. Leave blank for none."
            />
            <Field
              label="End-call phrases"
              value={c.endCallPhrases.join(", ")}
              onChange={e =>
                setConfig({
                  endCallPhrases: e.target.value
                    .split(",")
                    .map(s => s.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                })
              }
              placeholder="goodbye, have a nice day"
              hint="Comma separated. When the agent says one of these, the call ends."
            />
            <Select
              label="Background sound"
              options={BACKGROUND_SOUNDS.map(b => ({ ...b }))}
              value={c.backgroundSound}
              onChange={e => setConfig({ backgroundSound: e.target.value as AgentConfig["backgroundSound"] })}
              hint="Ambience can make an agent feel less synthetic on a phone line."
            />
            <Toggle
              label="Filter background noise"
              description="Denoise the caller's audio before transcription."
              checked={c.backgroundDenoisingEnabled}
              onChange={v => setConfig({ backgroundDenoisingEnabled: v })}
            />
          </Section>

          {/* ── Voicemail ──────────────────────────────────────────── */}
          <Section
            title="Voicemail"
            description="What happens when an outbound call reaches an answering machine."
          >
            <Toggle
              label="Detect voicemail"
              description="Recognise an answering machine instead of talking to the beep."
              checked={c.voicemailDetectionEnabled}
              onChange={v => setConfig({ voicemailDetectionEnabled: v })}
            />
            {c.voicemailDetectionEnabled && (
              <TextArea
                label="Voicemail message"
                rows={3}
                value={c.voicemailMessage}
                onChange={e => setConfig({ voicemailMessage: e.target.value })}
                maxLength={1000}
                hint="Left on the machine. Blank means hang up without leaving one."
              />
            )}
          </Section>

          {/* ── Analysis ───────────────────────────────────────────── */}
          <Section
            title="Post-call analysis"
            description="Summaries, outcome scoring and structured extraction."
          >
            <Toggle
              label="Summarise each call"
              description="A short written summary attached to the call record."
              checked={c.summaryEnabled}
              onChange={v => setConfig({ summaryEnabled: v })}
            />
            <Toggle
              label="Score call success"
              description="Judge whether the call achieved its goal."
              checked={c.successEvaluationEnabled}
              onChange={v => setConfig({ successEvaluationEnabled: v })}
            />
            <Toggle
              label="Extract structured data"
              description="Pull named fields out of the conversation, e.g. name and booking date."
              checked={c.structuredDataEnabled}
              onChange={v => setConfig({ structuredDataEnabled: v })}
            />
            {c.structuredDataEnabled && (
              <TextArea
                label="Extraction schema (JSON)"
                rows={8}
                value={c.structuredDataSchema}
                onChange={e => setConfig({ structuredDataSchema: e.target.value })}
                placeholder={`{\n  "type": "object",\n  "properties": {\n    "callerName": { "type": "string" }\n  }\n}`}
                hint="A JSON Schema object describing what to pull out."
              />
            )}
          </Section>

          {/* ── Responsiveness ─────────────────────────────────────── */}
          <Section
            title="Responsiveness"
            description="Turn-taking feel — how eagerly the agent speaks and yields."
          >
            <Field
              label="Wait before speaking (seconds)"
              type="number" min={0} max={5} step="0.1"
              value={String(c.startSpeakingWaitSeconds)}
              onChange={e => setConfig({ startSpeakingWaitSeconds: Number(e.target.value) })}
              hint="Higher feels more patient; lower feels more eager."
            />
            <Toggle
              label="Smart endpointing"
              description="Use the model to judge when the caller has finished, rather than silence alone."
              checked={c.smartEndpointingEnabled}
              onChange={v => setConfig({ smartEndpointingEnabled: v })}
            />
            <Field
              label="Words before yielding"
              type="number" min={0} max={20}
              value={String(c.stopSpeakingNumWords)}
              onChange={e => setConfig({ stopSpeakingNumWords: Number(e.target.value) })}
              hint="How many words the caller must say to interrupt. 0 interrupts instantly."
            />
            <Field
              label="Interruption voice threshold (seconds)"
              type="number" min={0} max={5} step="0.1"
              value={String(c.stopSpeakingVoiceSeconds)}
              onChange={e => setConfig({ stopSpeakingVoiceSeconds: Number(e.target.value) })}
            />
            <Field
              label="Pause after interruption (seconds)"
              type="number" min={0} max={10} step="0.1"
              value={String(c.stopSpeakingBackoffSeconds)}
              onChange={e => setConfig({ stopSpeakingBackoffSeconds: Number(e.target.value) })}
            />
          </Section>

          {/* ── Keypad ─────────────────────────────────────────────── */}
          <Section title="Keypad input" description="Collect digits pressed during the call (DTMF).">
            <Toggle
              label="Accept keypad input"
              description="Useful for account numbers, extensions and menu choices."
              checked={c.keypadInputEnabled}
              onChange={v => setConfig({ keypadInputEnabled: v })}
            />
            {c.keypadInputEnabled && (
              <Field
                label="Digit entry timeout (seconds)"
                type="number" min={1} max={30}
                value={String(c.keypadTimeoutSeconds)}
                onChange={e => setConfig({ keypadTimeoutSeconds: Number(e.target.value) })}
              />
            )}
          </Section>

          {/* ── Knowledge and tools ────────────────────────────────── */}
          <Section
            title="Knowledge and tools"
            description="Give the agent documents to draw on and actions it can take."
          >
            <Field
              label="Knowledge base ID"
              value={c.knowledgeBaseId}
              onChange={e => setConfig({ knowledgeBaseId: e.target.value })}
              placeholder="Leave blank for none"
              hint="Attaches an existing knowledge base so the agent can answer from your documents."
            />
            <ToolsEditor
              value={c.tools}
              onChange={tools => setConfig({ tools })}
              onAddGuidance={text =>
                setDraft(d => ({
                  ...d,
                  // Appended, never replacing — whatever they have written about
                  // tone and scope matters more than our outline.
                  systemPrompt: d.systemPrompt.trimEnd()
                    ? `${d.systemPrompt.trimEnd()}\n\n${text}`
                    : text,
                }))
              }
            />

            {/* Only shown when an older agent still carries raw JSON. New
                agents never see this; it exists so a pre-builder tool keeps
                working until it is migrated. */}
            {c.toolsJson.trim() !== "" && (
              <TextArea
                label="Legacy tools (raw JSON)"
                rows={8}
                value={c.toolsJson}
                onChange={e => setConfig({ toolsJson: e.target.value })}
                hint="These were set up before the tool builder existed. They still run — move them into Custom tools above when convenient, then clear this box."
              />
            )}
          </Section>

          {/* ── Compliance ─────────────────────────────────────────── */}
          <Section title="Compliance" description="Data handling for card payments.">
            <Toggle
              label="PCI mode"
              description="For agents that take card details. Turning this on stops recordings and transcripts being kept — this agent's calls will have no audio and no transcript in your call log, and past ones become unavailable. Only enable it if you genuinely handle card numbers."
              checked={c.pciEnabled}
              onChange={v => setConfig({ pciEnabled: v })}
            />
            {c.pciEnabled && (
              <ErrorNote>
                With PCI mode on, this agent&rsquo;s calls will not have a recording or
                transcript. Everything else — duration, cost, summary — still works.
              </ErrorNote>
            )}
          </Section>
        </form>
      </Panel>
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
  onEdit,
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
  onEdit: () => void
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
