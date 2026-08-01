"use client"

/**
 * The agent editor.
 *
 * ── WHY IT IS SHAPED LIKE THIS ────────────────────────────────────────
 *
 * There are around thirty settings here, and they are not equally important.
 * The previous version put all of them in one scroll inside a 520px slide-over,
 * which gave "Interruption voice threshold" the same visual weight as the system
 * prompt — so everything looked equally consequential and nothing looked
 * obvious. People either accepted defaults they hadn't read or changed dials
 * they didn't need.
 *
 * So: tabs, in the order somebody actually thinks.
 *
 *   Who it is       the four things every agent needs
 *   What it can do  tools, and whether the prompt actually uses them
 *   How it talks    voice behaviour and turn-taking
 *   Call control    limits, endings, voicemail
 *   After the call  recording, summaries, extraction
 *   JSON            the whole object, for anyone who wants it
 *
 * The checker sits alongside all of them, not inside one, because the problems
 * it finds are usually caused on one tab and visible on another — a tool
 * switched on under "What it can do" that the prompt under "Who it is" never
 * mentions.
 */

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { TextArea, Select, Toggle, SecondaryButton } from "@/components/ui/form"
import { type Option } from "@/lib/vapi/options"
import type { Draft } from "./draft"
import {
  DEFAULT_CONFIG,
  FIRST_MESSAGE_MODES,
  BACKGROUND_SOUNDS,
  LANGUAGES,
  type AgentConfig,
} from "@/lib/vapi/config"
import { ToolsEditor } from "@/components/agents/tools-editor"
import { JsonEditor } from "@/components/agents/json-editor"
import { checkAgent, countBySeverity, type Finding } from "@/lib/agents/prompt-check"
import { AGENT_TEMPLATES, CATEGORY_LABEL, type AgentTemplate } from "@/lib/agents/templates"
import { CRM_TOOLS, defaultCrmTool } from "@/lib/vapi/tools"
import { cn } from "@/lib/utils"

type TabKey = "identity" | "tools" | "conversation" | "control" | "after" | "json"

const TABS: { key: TabKey; label: string; blurb: string }[] = [
  { key: "identity",     label: "Who it is",      blurb: "Its name, its greeting, and what it's for." },
  { key: "tools",        label: "What it can do", blurb: "Actions it can take during a call." },
  { key: "conversation", label: "How it talks",   blurb: "Voice, pace, and turn-taking." },
  { key: "control",      label: "Call control",   blurb: "Limits, endings and voicemail." },
  { key: "after",        label: "After the call", blurb: "Recording, summaries and extraction." },
  { key: "json",         label: "JSON",           blurb: "The whole thing, editable." },
]

export function AgentEditor({
  agentId,
  initial,
  voices,
  models,
  transcribers,
  usedForOutbound,
}: {
  agentId?: string
  initial: Draft
  voices: Option[]
  models: Option[]
  transcribers: Option[]
  /** True when a campaign points at this agent — changes what the checker says. */
  usedForOutbound: boolean
}) {
  const editing = Boolean(agentId)
  const router = useRouter()

  const [draft, setDraft] = useState<Draft>(initial)
  const [tab, setTab] = useState<TabKey>("identity")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jsonValid, setJsonValid] = useState(true)
  const [applied, setApplied] = useState<string | null>(null)

  const c = draft.config
  const setConfig = (patch: Partial<AgentConfig>) =>
    setDraft(d => ({ ...d, config: { ...d.config, ...patch } }))

  const findings = useMemo(
    () => checkAgent({
      systemPrompt: draft.systemPrompt,
      firstMessage: draft.firstMessage,
      tools: c.tools,
      config: {
        voicemailDetectionEnabled: c.voicemailDetectionEnabled,
        voicemailMessage: c.voicemailMessage,
        structuredDataEnabled: c.structuredDataEnabled,
        structuredDataSchema: c.structuredDataSchema,
        successEvaluationEnabled: c.successEvaluationEnabled,
        maxTokens: c.maxTokens,
        endCallPhrases: c.endCallPhrases,
      },
      usedForOutbound,
    }),
    [draft.systemPrompt, draft.firstMessage, c, usedForOutbound]
  )

  const counts = countBySeverity(findings)

  function appendToPrompt(line: string) {
    setDraft(d => ({
      ...d,
      systemPrompt: d.systemPrompt.trimEnd()
        ? `${d.systemPrompt.trimEnd()}\n${line}`
        : line,
    }))
  }

  function applyTemplate(t: AgentTemplate) {
    const tools = t.tools
      .map(type => CRM_TOOLS.find(s => s.type === type))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map(defaultCrmTool)

    setDraft(d => ({
      ...d,
      // The name is theirs. Everything else is the template's.
      name: d.name,
      firstMessage: t.firstMessage,
      systemPrompt: t.systemPrompt,
      config: { ...DEFAULT_CONFIG, ...d.config, ...t.config, tools },
    }))
    setApplied(t.id)
    setTab("identity")
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(editing ? `/api/agents/${agentId}` : "/api/agents", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      router.push("/dashboard/agents")
      router.refresh()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        {error && <ErrorNote>{error}</ErrorNote>}

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              disabled={t.key !== "json" && !jsonValid}
              title={t.blurb}
              className={cn(
                "rounded-field border px-3.5 py-2 text-[13px] transition-colors disabled:opacity-50",
                tab === t.key
                  ? "border-brand-500/60 bg-brand-500/12 text-brand-on-tint"
                  : "border-line bg-field text-muted hover:border-line-strong"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="-mt-2 text-[12.5px] font-light text-subtle">
          {TABS.find(t => t.key === tab)?.blurb}
        </p>

        {/* ── Who it is ───────────────────────────────────────────── */}
        {tab === "identity" && (
          <div className="space-y-5">
            {!editing && <Templates applied={applied} onApply={applyTemplate} />}

            <Block title="The basics">
              <Field
                label="Agent name"
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder="Front desk"
                required minLength={2} maxLength={60}
                hint="Only you see this. It's how you'll pick it in a campaign."
              />
              <TextArea
                label="First thing it says"
                value={draft.firstMessage}
                onChange={e => setDraft({ ...draft, firstMessage: e.target.value })}
                rows={2} required maxLength={1000}
                hint="Said the moment the call connects. On outbound calls you can use {{name}} for the person's name."
              />
            </Block>

            <Block
              title="Instructions"
              description="The single thing that decides how good this agent is. Tell it who it is, what the call is for, how the call should go, and what it must never do."
            >
              <TextArea
                label="System prompt"
                value={draft.systemPrompt}
                onChange={e => setDraft({ ...draft, systemPrompt: e.target.value })}
                rows={16} required minLength={10} maxLength={8000}
              />
              <p className="text-[12px] font-light text-subtle">
                {draft.systemPrompt.length.toLocaleString()} of 8,000 characters. Rules about
                the CRM — looking someone up before creating them, never inventing a
                calendar slot — are added automatically, so you don&rsquo;t need to write
                them here.
              </p>
            </Block>

            <Block title="Voice and model">
              <Select
                label="Voice"
                options={voices}
                value={draft.voice}
                onChange={e => setDraft({ ...draft, voice: e.target.value })}
              />
              <ModelPicker
                models={models}
                value={draft.model}
                onChange={model => setDraft({ ...draft, model })}
              />
              <Select
                label="Who speaks first"
                options={FIRST_MESSAGE_MODES.map(m => ({ ...m }))}
                value={c.firstMessageMode}
                onChange={e => setConfig({ firstMessageMode: e.target.value as AgentConfig["firstMessageMode"] })}
              />
            </Block>
          </div>
        )}

        {/* ── What it can do ──────────────────────────────────────── */}
        {tab === "tools" && (
          <div className="space-y-5">
            <Block
              title="Actions"
              description="Switching one on gives the agent the ability. Your instructions decide whether it ever uses it — the checker on the right tells you which ones your prompt is silent about."
            >
              <ToolsEditor
                value={c.tools}
                onChange={tools => setConfig({ tools })}
                onAddGuidance={appendToPrompt}
              />
            </Block>

            <Block
              title="Knowledge"
              description="Give the agent documents it can answer from."
            >
              <Field
                label="Knowledge base ID"
                value={c.knowledgeBaseId}
                onChange={e => setConfig({ knowledgeBaseId: e.target.value })}
                placeholder="Leave blank for none"
              />
            </Block>

            {c.toolsJson.trim() !== "" && (
              <Block
                title="Older tools"
                description="Set up before the tool builder existed. They still run — move them into custom tools above when convenient, then clear this."
              >
                <TextArea
                  label="Raw JSON"
                  rows={8}
                  value={c.toolsJson}
                  onChange={e => setConfig({ toolsJson: e.target.value })}
                />
              </Block>
            )}
          </div>
        )}

        {/* ── How it talks ────────────────────────────────────────── */}
        {tab === "conversation" && (
          <div className="space-y-5">
            <Block
              title="Personality"
              description="How predictable it is, and how much it says at a time."
            >
              <Field
                label="Creativity"
                type="number" min={0} max={2} step="0.1"
                value={String(c.temperature)}
                onChange={e => setConfig({ temperature: Number(e.target.value) })}
                hint="0 gives the same answer every time and sounds robotic. Around 0.6 is natural. Above 1 starts improvising in ways you won't have planned for."
              />
              <Field
                label="Longest reply"
                type="number" min={50} max={4000} step="10"
                value={String(c.maxTokens)}
                onChange={e => setConfig({ maxTokens: Number(e.target.value) })}
                hint="Roughly 250 keeps it conversational. On a phone call, a long answer is one the other person talks over."
              />
            </Block>

            <Block
              title="Listening"
              description="How it hears the caller."
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
                label="Filter background noise"
                description="Clean up the caller's audio before transcribing it. Worth it for people calling from a car or a building site."
                checked={c.backgroundDenoisingEnabled}
                onChange={v => setConfig({ backgroundDenoisingEnabled: v })}
              />
              <Select
                label="Background sound"
                options={BACKGROUND_SOUNDS.map(b => ({ ...b }))}
                value={c.backgroundSound}
                onChange={e => setConfig({ backgroundSound: e.target.value as AgentConfig["backgroundSound"] })}
                hint="A little room ambience makes an agent feel less synthetic. Silence can sound like the line has dropped."
              />
            </Block>

            <Block
              title="Taking turns"
              description="Whether it feels patient or eager. These are the dials to reach for when an agent keeps talking over people, or leaves awkward gaps."
            >
              <Toggle
                label="Caller can interrupt the greeting"
                description="Let them start talking over the first message instead of waiting for it to finish."
                checked={c.firstMessageInterruptionsEnabled}
                onChange={v => setConfig({ firstMessageInterruptionsEnabled: v })}
              />
              <Toggle
                label="Judge when they've finished"
                description="Work out whether the caller has finished their sentence, rather than just waiting for silence. Usually worth leaving on."
                checked={c.smartEndpointingEnabled}
                onChange={v => setConfig({ smartEndpointingEnabled: v })}
              />
              <Field
                label="Pause before replying (seconds)"
                type="number" min={0} max={5} step="0.1"
                value={String(c.startSpeakingWaitSeconds)}
                onChange={e => setConfig({ startSpeakingWaitSeconds: Number(e.target.value) })}
                hint="Higher feels considered. Lower feels eager, and starts interrupting."
              />
              <Field
                label="Words needed to interrupt"
                type="number" min={0} max={20}
                value={String(c.stopSpeakingNumWords)}
                onChange={e => setConfig({ stopSpeakingNumWords: Number(e.target.value) })}
                hint="0 stops the moment it hears anything — including a cough. Two or three ignores noise."
              />
              <Field
                label="Sound needed to interrupt (seconds)"
                type="number" min={0} max={5} step="0.1"
                value={String(c.stopSpeakingVoiceSeconds)}
                onChange={e => setConfig({ stopSpeakingVoiceSeconds: Number(e.target.value) })}
              />
              <Field
                label="Pause after being interrupted (seconds)"
                type="number" min={0} max={10} step="0.1"
                value={String(c.stopSpeakingBackoffSeconds)}
                onChange={e => setConfig({ stopSpeakingBackoffSeconds: Number(e.target.value) })}
              />
            </Block>

            <Block
              title="Keypad"
              description="Collect digits the caller presses — account numbers, extensions, menu choices."
            >
              <Toggle
                label="Accept keypad input"
                checked={c.keypadInputEnabled}
                onChange={v => setConfig({ keypadInputEnabled: v })}
              />
              {c.keypadInputEnabled && (
                <Field
                  label="Wait for digits (seconds)"
                  type="number" min={1} max={30}
                  value={String(c.keypadTimeoutSeconds)}
                  onChange={e => setConfig({ keypadTimeoutSeconds: Number(e.target.value) })}
                />
              )}
            </Block>
          </div>
        )}

        {/* ── Call control ────────────────────────────────────────── */}
        {tab === "control" && (
          <div className="space-y-5">
            <Block
              title="Limits"
              description="What stops a call that isn't going anywhere."
            >
              <Field
                label="Longest a call can run (seconds)"
                type="number" min={30} max={43200}
                value={String(c.maxDurationSeconds)}
                onChange={e => setConfig({ maxDurationSeconds: Number(e.target.value) })}
                hint="A hard cap, and your protection against a stuck call quietly burning minutes. 600 is ten minutes."
              />
              <Field
                label="Hang up after silence (seconds)"
                type="number" min={10} max={3600}
                value={String(c.silenceTimeoutSeconds)}
                onChange={e => setConfig({ silenceTimeoutSeconds: Number(e.target.value) })}
                hint="Covers the caller putting the phone down without hanging up."
              />
            </Block>

            <Block
              title="Ending the call"
              description="How it finishes, and what it listens for."
            >
              <TextArea
                label="Sign-off"
                rows={2}
                value={c.endCallMessage}
                onChange={e => setConfig({ endCallMessage: e.target.value })}
                maxLength={1000}
                hint="Said just before it hangs up. Leave blank for none."
              />
              <Field
                label="Phrases that end the call"
                value={c.endCallPhrases.join(", ")}
                onChange={e =>
                  setConfig({
                    endCallPhrases: e.target.value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20),
                  })
                }
                placeholder="goodbye, have a nice day"
                hint="Comma separated. When the agent says one of these, the call ends."
              />
            </Block>

            <Block
              title="Answering machines"
              description="Only matters on outbound calls."
            >
              <Toggle
                label="Detect voicemail"
                description="Without this it can't tell a machine from a person — it holds a full conversation with the answerphone, and that gets recorded as somebody you spoke to."
                checked={c.voicemailDetectionEnabled}
                onChange={v => setConfig({ voicemailDetectionEnabled: v })}
              />
              {c.voicemailDetectionEnabled && (
                <TextArea
                  label="Message to leave"
                  rows={3}
                  value={c.voicemailMessage}
                  onChange={e => setConfig({ voicemailMessage: e.target.value })}
                  maxLength={1000}
                  hint="Blank means hang up without leaving one, which is a perfectly reasonable choice."
                />
              )}
            </Block>
          </div>
        )}

        {/* ── After the call ──────────────────────────────────────── */}
        {tab === "after" && (
          <div className="space-y-5">
            <Block title="What's kept">
              <Toggle
                label="Record calls"
                description="Audio you can play back from the call log."
                checked={draft.recordingEnabled}
                onChange={v => setDraft({ ...draft, recordingEnabled: v })}
              />
              <Toggle
                label="Transcribe calls"
                description="A written transcript alongside each recording."
                checked={draft.transcriptionEnabled}
                onChange={v => setDraft({ ...draft, transcriptionEnabled: v })}
              />
            </Block>

            <Block
              title="What's worked out"
              description="Read from the conversation once it ends."
            >
              <Toggle
                label="Write a summary"
                description="A short account of the call, on the call record."
                checked={c.summaryEnabled}
                onChange={v => setConfig({ summaryEnabled: v })}
              />
              <Toggle
                label="Judge whether it went well"
                description="Scores whether the call achieved what it set out to. This is what fills in the success figure on your analytics."
                checked={c.successEvaluationEnabled}
                onChange={v => setConfig({ successEvaluationEnabled: v })}
              />
              <Toggle
                label="Pull out specific details"
                description="Extract named values — a booking date, a budget, a postcode — into fields you can report on."
                checked={c.structuredDataEnabled}
                onChange={v => setConfig({ structuredDataEnabled: v })}
              />
              {c.structuredDataEnabled && (
                <TextArea
                  label="What to pull out (JSON Schema)"
                  rows={8}
                  value={c.structuredDataSchema}
                  onChange={e => setConfig({ structuredDataSchema: e.target.value })}
                  placeholder={`{\n  "type": "object",\n  "properties": {\n    "callerName": { "type": "string" }\n  }\n}`}
                  hint="Without this, extraction returns nothing on every call."
                />
              )}
            </Block>

            <Block
              title="Card payments"
              description="Only for agents that genuinely take card details."
            >
              <Toggle
                label="PCI mode"
                description="Stops recordings and transcripts being kept at all. This agent's calls will have no audio and no transcript in your call log, and existing ones become unavailable."
                checked={c.pciEnabled}
                onChange={v => setConfig({ pciEnabled: v })}
              />
              {c.pciEnabled && (
                <ErrorNote>
                  With PCI mode on, this agent&rsquo;s calls will have no recording and no
                  transcript. Duration, cost and summary still work.
                </ErrorNote>
              )}
            </Block>
          </div>
        )}

        {/* ── JSON ────────────────────────────────────────────────── */}
        {tab === "json" && (
          <Block
            title="The whole agent"
            description="Everything above, as one object. Changes here show up on the other tabs, and you can't save while it's invalid."
          >
            <JsonEditor
              key={agentId ?? "new"}
              draft={draft}
              onChange={setDraft}
              onValidityChange={setJsonValid}
            />
          </Block>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <Link
            href="/dashboard/agents"
            className="rounded-field border border-line bg-field px-4 py-2.5 text-[13px] text-muted transition-colors hover:border-line-strong"
          >
            Cancel
          </Link>
          <SubmitButton
            type="submit" sheen={false} className="w-auto px-6"
            loading={busy} disabled={!jsonValid || !draft.name.trim()}
          >
            {editing ? "Save changes" : "Create agent"}
          </SubmitButton>
        </div>
      </div>

      {/* ── The checker ─────────────────────────────────────────────── */}
      <aside className="xl:sticky xl:top-8 xl:self-start">
        <div className="rounded-2xl border border-line bg-field-soft">
          <header className="border-b border-line px-5 py-3.5">
            <h2 className="text-[13.5px] font-medium">Before you save</h2>
            <p className="mt-0.5 text-[12px] font-light text-muted">
              {findings.length === 0
                ? "Nothing to flag."
                : `${counts.problems} to fix${counts.suggestions ? `, ${counts.suggestions} to consider` : ""}`}
            </p>
          </header>

          <div className="px-5 py-4">
            {findings.length === 0 ? (
              <p className="text-[12.5px] font-light text-muted">
                Every tool you&rsquo;ve switched on is described in your instructions, and
                nothing contradicts anything else.
              </p>
            ) : (
              <ul className="space-y-4">
                {findings.map(f => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    onInsert={f.insert ? () => appendToPrompt(f.insert!) : undefined}
                    onGo={() => setTab(f.where === "identity" ? "identity"
                                    : f.where === "tools" ? "tools"
                                    : f.where === "after" ? "after" : "conversation")}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <p className="mt-3 px-1 text-[11.5px] font-light text-subtle">
          These are checks on your setup, not on the agent&rsquo;s performance. Test a real
          call before pointing anyone at it.
        </p>
      </aside>
    </form>
  )
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

function Block({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-field-soft">
      <header className="border-b border-line px-6 py-4">
        <h2 className="text-[14px] font-medium">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] font-light text-muted">{description}</p>}
      </header>
      <div className="space-y-5 px-6 py-5">{children}</div>
    </section>
  )
}

function FindingCard({
  finding, onInsert, onGo,
}: { finding: Finding; onInsert?: () => void; onGo: () => void }) {
  const problem = finding.severity === "problem"
  return (
    <li className={cn(
      "rounded-field border px-3.5 py-3",
      problem ? "border-warning/30 bg-warning/8" : "border-line bg-field"
    )}>
      <p className={cn("text-[12.5px] font-medium", problem ? "text-warning" : "text-fg")}>
        {finding.title}
      </p>
      <p className="mt-1 text-[12px] font-light leading-relaxed text-muted">{finding.detail}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {onInsert && (
          <button
            type="button"
            onClick={onInsert}
            className="rounded-xs border border-line-strong bg-field px-2.5 py-1 text-[11.5px] text-fg transition-colors hover:border-brand-400"
          >
            Add a line to the prompt
          </button>
        )}
        <button
          type="button"
          onClick={onGo}
          className="rounded-xs px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:text-fg"
        >
          Take me there
        </button>
      </div>
    </li>
  )
}

function Templates({
  applied, onApply,
}: { applied: string | null; onApply: (t: AgentTemplate) => void }) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section className="rounded-2xl border border-line bg-field-soft">
      <header className="border-b border-line px-6 py-4">
        <h2 className="text-[14px] font-medium">Start from a template</h2>
        <p className="mt-1 text-[12.5px] font-light text-muted">
          Each one comes with the instructions already written and the right actions
          switched on, in the right order. Change anything you like afterwards.
        </p>
      </header>
      <div className="grid gap-3 px-6 py-5 sm:grid-cols-2">
        {AGENT_TEMPLATES.map(t => {
          const isApplied = applied === t.id
          const expanded = open === t.id
          return (
            <div
              key={t.id}
              className={cn(
                "rounded-field border px-4 py-3.5 transition-colors",
                isApplied
                  ? "border-brand-500/60 bg-brand-500/12"
                  : "border-line bg-field hover:border-line-strong"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("text-[13px] font-medium", isApplied && "text-brand-on-tint")}>
                    {t.name}
                  </p>
                  <p className="mt-0.5 text-[11.5px] font-light text-subtle">
                    {CATEGORY_LABEL[t.category]}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onApply(t)}
                  className="shrink-0 rounded-xs border border-line-strong bg-field px-2.5 py-1 text-[11.5px] text-fg transition-colors hover:border-brand-400"
                >
                  {isApplied ? "Applied" : "Use"}
                </button>
              </div>

              <p className="mt-2 text-[12px] font-light leading-relaxed text-muted">
                {t.summary}
              </p>

              {t.flow.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : t.id)}
                    className="mt-2 text-[11.5px] text-muted transition-colors hover:text-fg"
                  >
                    {expanded ? "Hide the call flow" : "What does it do?"}
                  </button>
                  {expanded && (
                    <>
                      <ol className="mt-2 ml-4 list-decimal space-y-1 text-[11.5px] font-light text-subtle marker:text-subtle">
                        {t.flow.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                      {t.requires?.length ? (
                        <p className="mt-2 text-[11.5px] font-light text-warning">
                          Needs: {t.requires.join(" · ")}
                        </p>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
      {applied && (
        <div className="border-t border-line px-6 py-4">
          <InfoNote>
            Template applied. Read through the instructions below and replace anything in
            square brackets — those get read out loud exactly as written.
          </InfoNote>
        </div>
      )}
    </section>
  )
}

/* ── Choosing a language model ─────────────────────────────────────────── */

/**
 * A select was fine for eight models. It is not fine for three hundred.
 *
 * Once an OpenRouter key is attached to the provider account, every model on
 * their catalogue becomes reachable, and a plain dropdown turns that into
 * scrolling past three hundred names to find one you already know. Typing to
 * narrow is how anyone actually picks.
 *
 * The eight curated ones stay pinned at the top and unfiltered until you type,
 * because the ordering is the recommendation: those are the models proven on a
 * phone call. The rest are available because the account can reach them, which
 * is not the same as being a good idea on a live conversation — a model that
 * takes four seconds to think is not broken, it is just painful to talk to.
 */
function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: Option[]
  value: string
  onChange: (value: string) => void
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()

  const shown = q
    ? models.filter(m => m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q))
    : models.slice(0, 8)

  const selected = models.find(m => m.value === value)

  return (
    <div className="space-y-2">
      <Field
        label="Language model"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${models.length.toLocaleString()} models…`}
        hint="Faster models cost less per minute and reply more quickly. The difference is very audible on a phone call."
      />

      <p className="text-[12.5px] text-muted">
        Using{" "}
        <span className="text-fg">{selected?.label ?? value ?? "nothing yet"}</span>
        {selected?.note ? <span className="text-subtle"> · {selected.note}</span> : null}
      </p>

      {shown.length === 0 ? (
        <p className="text-[12.5px] text-subtle">
          No model matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="max-h-52 overflow-y-auto rounded-field border border-line bg-field-soft">
          {!q && (
            <p className="px-3 pt-2.5 text-[11px] uppercase tracking-[0.08em] text-subtle">
              Recommended for phone calls
            </p>
          )}
          <ul className="p-1.5">
            {shown.map(m => {
              const on = m.value === value
              return (
                <li key={m.value}>
                  <button
                    type="button"
                    onClick={() => onChange(m.value)}
                    className={cn(
                      "flex w-full items-baseline justify-between gap-3 rounded-field px-2.5 py-1.5 text-left transition-colors",
                      on ? "bg-brand-500/15 text-brand-on-tint" : "text-muted hover:bg-field-hover hover:text-fg"
                    )}
                  >
                    <span className="text-[13px]">{m.label}</span>
                    {m.note && <span className="shrink-0 text-[11.5px] text-subtle">{m.note}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {!q && models.length > 8 && (
        <p className="text-[11.5px] text-subtle">
          {(models.length - 8).toLocaleString()} more available — start typing to
          find one.
        </p>
      )}
    </div>
  )
}
