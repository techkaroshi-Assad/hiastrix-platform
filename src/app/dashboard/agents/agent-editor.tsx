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
  type AgentTool,
} from "@/lib/vapi/config"
import { ToolsEditor } from "@/components/agents/tools-editor"
import { JsonEditor } from "@/components/agents/json-editor"
import { checkAgent, countBySeverity, type Finding } from "@/lib/agents/prompt-check"
import {
  promptContains, tidyPrompt, approxTokens, templateOverwrites,
  type TidyResult, type Overwrite,
} from "@/lib/agents/prompt-structure"
import { enforcedRules } from "@/lib/crm/guidance"
import {
  AGENT_TEMPLATES, JOB_LABEL, JOB_ORDER, DIRECTION_LABEL, INDUSTRY_LABEL,
  INDUSTRIES_PRESENT, filterTemplates,
  type AgentTemplate, type TemplateJob, type TemplateDirection, type TemplateIndustry,
} from "@/lib/agents/templates"
import {
  JOB_ICON, INDUSTRY_ICON, DIRECTION_ICON,
  IconSearch, IconWarning, IconChevron, type Icon,
} from "@/components/app/icons"
import { Disclosure, DisclosureList } from "@/components/ui/disclosure"
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

/** The human names of the actions currently switched on, for "this will go". */
function toolLabels(tools: AgentTool[]): string[] {
  return tools.map(t => CRM_TOOLS.find(s => s.type === t.type)?.label ?? t.type)
}

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
  /** A one-line acknowledgement — "already there", "nothing to remove". */
  const [note, setNote] = useState<string | null>(null)
  /** What tidying would remove, shown before anything is applied. */
  const [tidy, setTidy] = useState<TidyResult | null>(null)
  const [preview, setPreview] = useState(false)
  /**
   * A template waiting on an answer, because applying it would destroy writing
   * the tenant did themselves. Null in the ordinary case — an empty agent, or
   * swapping one untouched template for another — where it applies straight
   * away and says nothing.
   */
  const [pending, setPending] =
    useState<{ template: AgentTemplate; overwrites: Overwrite[] } | null>(null)

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

  const promptTokens = useMemo(() => approxTokens(draft.systemPrompt), [draft.systemPrompt])

  /* The prompt as the model actually receives it — theirs, plus everything we
   * append at dial time. */
  const assembledPrompt = useMemo(
    () => draft.systemPrompt + enforcedRules(c.tools, { timeZone: previewTimeZone(c.tools) }),
    [draft.systemPrompt, c.tools]
  )

  /**
   * Add a block to the prompt — once.
   *
   * This used to be a blind concat, and a live agent's prompt was found
   * carrying the same eleven-line section four times because of it. Each
   * enabled tool offers its own near-identical block, so four tools and four
   * presses produced four copies, each one paid for on every turn of every
   * call. Nothing warned, and repetition makes a model follow instructions
   * *less* reliably, not more.
   *
   * `promptContains` compares on normalised lines, so a block already present
   * in slightly different punctuation is still recognised as present.
   */
  function appendToPrompt(line: string) {
    setDraft(d => {
      if (promptContains(d.systemPrompt, line)) {
        setNote("That's already in the instructions — nothing added.")
        return d
      }
      setNote(null)
      return {
        ...d,
        systemPrompt: d.systemPrompt.trimEnd()
          ? `${d.systemPrompt.trimEnd()}\n\n${line}`
          : line,
      }
    })
  }

  /**
   * Remove what is duplicated, after showing what will go.
   *
   * Two presses on purpose: the first shows what would be removed, the second
   * does it. A prompt is the tenant's own writing and the platform does not get
   * to rewrite it behind their back — and the preview is also the explanation
   * of why the agent could not be published.
   */
  function runTidy() {
    const result = tidyPrompt(draft.systemPrompt)
    if (!result.changed) {
      setTidy(null)
      setNote("Nothing repeated to remove.")
      return
    }
    setTidy(result)
  }

  function applyTidy() {
    if (!tidy) return
    setDraft(d => ({ ...d, systemPrompt: tidy.prompt }))
    setTidy(null)
    setNote("Repeated sections removed. Nothing else was changed.")
  }

  /**
   * Ask before overwriting somebody's own words.
   *
   * Pressing "Use" on a template used to replace the instructions, the greeting
   * and the enabled actions on the spot, with no warning and nothing to undo
   * with. On an empty agent that is exactly right and stopping to ask would be
   * pure friction — so it still applies silently there, and only stops when the
   * text in the box is the tenant's own writing rather than one of ours they
   * have not touched.
   */
  function applyTemplate(t: AgentTemplate) {
    const overwrites = templateOverwrites(
      {
        systemPrompt: draft.systemPrompt,
        firstMessage: draft.firstMessage,
        toolLabels: toolLabels(c.tools),
      },
      {
        systemPrompt: t.systemPrompt,
        firstMessage: t.firstMessage,
        toolLabels: t.tools
          .map(type => CRM_TOOLS.find(s => s.type === type)?.label ?? type),
      },
      AGENT_TEMPLATES,
    )

    if (!overwrites.length) { commitTemplate(t, false); return }
    setNote(null)
    setPending({ template: t, overwrites })
  }

  /**
   * @param keepWriting take the actions and the settings, leave their words
   *   alone. This is the option that did not exist before: the reason people
   *   reach for a template on a half-written agent is usually the tool ordering
   *   and the call settings, not the prose.
   */
  function commitTemplate(t: AgentTemplate, keepWriting: boolean) {
    const tools = t.tools
      .map(type => CRM_TOOLS.find(s => s.type === type))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map(defaultCrmTool)

    setDraft(d => ({
      ...d,
      // The name is theirs. Everything else is the template's.
      name: d.name,
      firstMessage: keepWriting ? d.firstMessage : t.firstMessage,
      systemPrompt: keepWriting ? d.systemPrompt : t.systemPrompt,
      config: { ...DEFAULT_CONFIG, ...d.config, ...t.config, tools },
    }))
    setApplied(t.id)
    setPending(null)
    setNote(keepWriting
      ? "Actions and settings taken from the template. Your instructions are untouched."
      : null)
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

            {pending && (
              <TemplateWarning
                template={pending.template}
                overwrites={pending.overwrites}
                onReplace={() => commitTemplate(pending.template, false)}
                onKeep={() => commitTemplate(pending.template, true)}
                onCancel={() => setPending(null)}
              />
            )}

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
                help={<>Everything the agent knows about who it is and what the call is for. Be specific about what it must <em>not</em> do — “never quote a price” works, hoping it won’t doesn’t. Square brackets like [YOUR COMPANY] get read out loud exactly as written, so publishing is blocked until they’re gone.</>}
                helpHref="/dashboard/help#agents"
                value={draft.systemPrompt}
                onChange={e => setDraft({ ...draft, systemPrompt: e.target.value })}
                rows={16} required minLength={10} maxLength={8000}
              />
              {/*
                Length in tokens rather than characters, because tokens are what
                is paid for on every turn of every call — and a prompt that had
                quietly grown to four copies of one section was invisible when
                the only number on screen was a character count against a limit
                nobody was near.
              */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-light text-subtle">
                  About {promptTokens.toLocaleString()} tokens, carried on every turn
                  of every call.
                </p>
                <div className="flex gap-2">
                  <SecondaryButton type="button" onClick={runTidy}>
                    Remove anything repeated
                  </SecondaryButton>
                  <SecondaryButton type="button" onClick={() => setPreview(p => !p)}>
                    {preview ? "Hide" : "Preview"} what the agent gets
                  </SecondaryButton>
                </div>
              </div>

              {note && <InfoNote>{note}</InfoNote>}

              {/* What would go, before anything goes. */}
              {tidy && (
                <div className="rounded-field border border-warning/40 bg-warning/[0.07] px-4 py-3.5">
                  <p className="text-[13px] font-medium text-warning">
                    {tidy.removedBlocks.length + tidy.removedLines.length} repeated{" "}
                    {tidy.removedBlocks.length + tidy.removedLines.length === 1 ? "piece" : "pieces"} to remove
                  </p>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[12.5px] text-muted">
                    {[...tidy.removedBlocks, ...tidy.removedLines].slice(0, 12).map((r, i) => (
                      <li key={i} className="truncate">— {r}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[12px] leading-relaxed text-subtle">
                    Only second and later copies go. Everything your prompt says, it
                    will still say.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <SecondaryButton type="button" onClick={() => setTidy(null)}>
                      Leave it
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      onClick={applyTidy}
                      className="border-brand-500/60 text-brand-on-tint"
                    >
                      Remove them
                    </SecondaryButton>
                  </div>
                </div>
              )}

              {/*
                The prompt as the agent actually receives it.
                
                What a tenant writes is not what the model gets — the CRM rules,
                the consent line, the date and the caller's number are all added
                at dial time. Four repeated sections would have been obvious the
                moment anyone looked at the assembled thing, and so would an
                agent thinking in UTC.
              */}
              {preview && (
                <div className="rounded-field border border-line bg-field-soft p-3">
                  <p className="mb-2 text-[12px] text-subtle">
                    Everything below is sent to the model on every call. The part
                    after the line is added by Hi-Astrix and can&rsquo;t be edited.
                  </p>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-muted">
                    {assembledPrompt}
                  </pre>
                </div>
              )}

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
                help={<>How much the agent varies its wording. Low keeps it consistent and on-script, which is what you want for anything with rules — bookings, prices, compliance. High sounds more natural and improvises more, including occasionally improvising something you didn’t intend.</>}
                helpHref="/dashboard/help#agents"
                type="number" min={0} max={2} step="0.1"
                value={String(c.temperature)}
                onChange={e => setConfig({ temperature: Number(e.target.value) })}
                hint="0 gives the same answer every time and sounds robotic. Around 0.6 is natural. Above 1 starts improvising in ways you won't have planned for."
              />
              <Field
                label="Longest reply"
                help={<>A ceiling on how much the agent can say in one turn. Low keeps it snappy and stops it monologuing; too low and it gets cut off mid-sentence. Around 250 suits most phone conversations.</>}
                helpHref="/dashboard/help#agents"
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
                help={<>Cleans up the caller’s audio before the agent hears it. Worth it for people ringing from a car or a building site; it adds a little delay, so leave it off if your callers are usually somewhere quiet.</>}
                helpHref="/dashboard/help#agents"
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
                help={<>The agent waits for a natural end to your sentence rather than a fixed gap of silence. Leave it on — with it off, anybody who pauses to think gets interrupted.</>}
                helpHref="/dashboard/help#agents"
                description="Work out whether the caller has finished their sentence, rather than just waiting for silence. Usually worth leaving on."
                checked={c.smartEndpointingEnabled}
                onChange={v => setConfig({ smartEndpointingEnabled: v })}
              />
              <Field
                label="Pause before replying (seconds)"
                help={<>How long the agent waits after you stop before it starts talking. Shorter feels sharp and risks talking over someone mid-thought; longer feels calm and starts to read as a bad line.</>}
                helpHref="/dashboard/help#agents"
                type="number" min={0} max={5} step="0.1"
                value={String(c.startSpeakingWaitSeconds)}
                onChange={e => setConfig({ startSpeakingWaitSeconds: Number(e.target.value) })}
                hint="Higher feels considered. Lower feels eager, and starts interrupting."
              />
              <Field
                label="Words needed to interrupt"
                help={<>How many words you have to say before the agent stops talking and listens. Zero means any sound cuts it off — a cough, a passing car. Two or three suits a noisy line.</>}
                helpHref="/dashboard/help#agents"
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
                help={<>A hard ceiling. The call ends when it’s reached, mid-sentence if necessary, so set it above a realistic worst case rather than at your average. It exists to stop one stuck call costing an hour of minutes.</>}
                helpHref="/dashboard/help#agents"
                type="number" min={30} max={43200}
                value={String(c.maxDurationSeconds)}
                onChange={e => setConfig({ maxDurationSeconds: Number(e.target.value) })}
                hint="A hard cap, and your protection against a stuck call quietly burning minutes. 600 is ten minutes."
              />
              <Field
                label="Hang up after silence (seconds)"
                help={<>How long total silence lasts before the agent ends the call. This is what stops you paying for a call somebody abandoned without hanging up; a phone left on a desk otherwise runs to the length limit.</>}
                helpHref="/dashboard/help#agents"
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
                help={<>Say one of these and the agent hangs up. Good for a clean sign-off, risky if it’s something a caller might say in passing — “thanks, bye” is fine, “that’s all” is not.</>}
                helpHref="/dashboard/help#agents"
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
                help={<>The agent works out it has reached an answering machine rather than a person. Essential on outbound campaigns: without it the agent holds a full conversation with a beep and burns a whole attempt.</>}
                helpHref="/dashboard/help#campaigns"
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
                help={<>Keeps the audio, playable from the call page. Off means no recording is stored for this agent at all. Check the rules where you’re calling — some places require you to tell people they’re being recorded.</>}
                helpHref="/dashboard/help#calls"
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
                help={<>After each call the model scores whether it achieved its goal, and that appears on Analytics as a success rate. The denominator is only the calls that were scored, which is why the figure there says “of N scored”.</>}
                helpHref="/dashboard/help#calls"
                description="Scores whether the call achieved what it set out to. This is what fills in the success figure on your analytics."
                checked={c.successEvaluationEnabled}
                onChange={v => setConfig({ successEvaluationEnabled: v })}
              />
              <Toggle
                label="Pull out specific details"
                help={<>Extracts named fields from the conversation into structured data you can read back — budget, postcode, which product they asked about. You describe what you want as a JSON schema and it’s filled in per call.</>}
                helpHref="/dashboard/help#calls"
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

/**
 * What a template is about to take away.
 *
 * Deliberately not a modal. It appears in the page, under the template list,
 * with the instructions it is talking about still visible below it — the
 * decision is easier to make while you can see the thing being decided about.
 */
function TemplateWarning({
  template, overwrites, onReplace, onKeep, onCancel,
}: {
  template: AgentTemplate
  overwrites: Overwrite[]
  onReplace: () => void
  onKeep: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/8 px-6 py-5">
      <h3 className="text-[13.5px] font-medium">
        “{template.name}” would replace what you&apos;ve written
      </h3>
      <p className="mt-1 text-[12.5px] font-light text-muted">
        This can&apos;t be undone, so here&apos;s exactly what goes:
      </p>

      <ul className="mt-3 space-y-1.5">
        {overwrites.map(o => (
          <li key={o.field} className="text-[12.5px] font-light">
            <span className="text-fg">{o.label}</span>
            <span className="text-subtle"> — {o.detail}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReplace}
          className="rounded-field border border-warning/60 bg-warning/15 px-3.5 py-2 text-[12.5px] text-fg transition-colors hover:border-warning"
        >
          Replace it with the template
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="rounded-field border border-line-strong bg-field px-3.5 py-2 text-[12.5px] text-fg transition-colors hover:border-brand-400"
        >
          Keep my writing, take the actions and settings
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-field px-3.5 py-2 text-[12.5px] font-light text-muted transition-colors hover:text-fg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Browsing thirty-eight templates.
 *
 * A flat grid was fine for ten and is not fine for thirty-eight. The trouble is
 * that there are three independent things somebody might be narrowing by, and
 * they are genuinely independent — job, direction and trade — so nesting them
 * into one list makes two of the three unreachable.
 *
 * So: job is the tab row, because it is how people describe what they want
 * ("something to answer the phone"). Direction and trade are chips, because
 * they are refinements on that. And there is a search box, because somebody who
 * already knows the template is called "Speed to lead" should not have to find
 * which tab it lives under.
 *
 * The counts on the tabs are not decoration. Without them, switching to a tab
 * that turns out to be empty under the current chips reads as a broken page.
 */
/**
 * Browsing thirty-eight templates.
 *
 * ── WHY SECTIONS AND NOT A GRID ───────────────────────────────────────
 *
 * The first version of this was one flat grid, which was fine for ten
 * templates and a wall for thirty-eight. The second was a row of job tabs,
 * which was better and still wrong in one specific way: a tab row shows you one
 * category and hides the other five, so the answer to "what can I start from"
 * was never on screen at once.
 *
 * Collapsed sections answer that. Six headings with counts fit in the space of
 * four cards, so the shape of the library is visible immediately, and opening
 * one is a click. Only the first is open on arrival — a screen where nothing at
 * all is open reads as broken rather than as tidy.
 *
 * ── THE THREE FILTERS ─────────────────────────────────────────────────
 *
 * Job is the grouping. Direction and trade are genuinely independent of it and
 * of each other, so they are chips rather than a nested menu. Search sits above
 * everything, because somebody who already knows the template is called "Speed
 * to lead" should not have to work out which section it lives in — and while a
 * search is active every matching section opens itself, since a closed section
 * hiding the one result you searched for is the worst possible outcome.
 */
function Templates({
  applied, onApply,
}: { applied: string | null; onApply: (t: AgentTemplate) => void }) {
  const [direction, setDirection] = useState<TemplateDirection | "all">("all")
  const [industry, setIndustry]   = useState<TemplateIndustry | "all" | "generic">("all")
  const [query, setQuery]         = useState("")

  const shown = useMemo(
    () => filterTemplates(AGENT_TEMPLATES, { direction, industry, query }),
    [direction, industry, query]
  )

  const searching = query.trim().length > 0
  const groups = JOB_ORDER
    .map(job => ({ job, items: shown.filter(t => t.job === job) }))
    .filter(g => g.items.length > 0)

  return (
    <section className="rounded-2xl border border-line bg-field-soft">
      <header className="border-b border-line px-6 py-4">
        <h2 className="text-[14px] font-medium">Start from a template</h2>
        <p className="mt-1 text-[12.5px] font-light text-muted">
          Each one comes with the instructions already written and the right actions
          switched on, in the right order. Change anything you like afterwards.
        </p>
      </header>

      {/* ── Search ──────────────────────────────────────────────────── */}
      <div className="border-b border-line px-6 py-3">
        <div className="relative">
          <IconSearch
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
            className="w-full rounded-field border border-line bg-field py-2 pl-9 pr-3 text-[13px] text-fg outline-none transition-colors placeholder:text-subtle focus:border-brand-400"
          />
        </div>
      </div>

      {/* ── Refinements ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-6 py-3">
        <ChipRow
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "all", label: "Any" },
            ...(["inbound", "outbound"] as const).map(d => ({
              value: d, label: DIRECTION_LABEL[d], icon: DIRECTION_ICON[d],
            })),
          ]}
        />
        <ChipRow
          label="Written for"
          value={industry}
          onChange={setIndustry}
          options={[
            { value: "all", label: "Anything" },
            { value: "generic", label: "Any business" },
            ...INDUSTRIES_PRESENT.map(i => ({
              value: i, label: INDUSTRY_LABEL[i], icon: INDUSTRY_ICON[i],
            })),
          ]}
        />
      </div>

      {/* ── The sections ────────────────────────────────────────────── */}
      {groups.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-[13px] text-muted">Nothing matches that.</p>
          <button
            type="button"
            onClick={() => { setDirection("all"); setIndustry("all"); setQuery("") }}
            className="mt-2 text-[12.5px] text-brand-300 transition-colors hover:text-brand-200"
          >
            Clear the filters
          </button>
        </div>
      ) : (
        <div className="px-6 py-5">
          <DisclosureList>
            {groups.map((g, i) => {
              const Glyph = JOB_ICON[g.job]
              return (
                <Disclosure
                  /* Keyed on the search text as well as the job, so that
                   * changing the search remounts the section and `defaultOpen`
                   * is re-applied. Without the key, React keeps the previous
                   * open/closed state and a search can land its only result
                   * inside a section that stays shut. */
                  key={`${g.job}:${searching}`}
                  title={JOB_LABEL[g.job]}
                  summary={JOB_BLURB[g.job]}
                  icon={<Glyph size={17} />}
                  meta={`${g.items.length}`}
                  defaultOpen={searching || i === 0}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {g.items.map(t => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        applied={applied === t.id}
                        onApply={onApply}
                      />
                    ))}
                  </div>
                </Disclosure>
              )
            })}
          </DisclosureList>
        </div>
      )}

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

/** One line per category, so a closed section still says what is inside it. */
const JOB_BLURB: Record<TemplateJob, string> = {
  "front-desk": "Answering the phone, taking messages, getting people to the right person.",
  sales:        "Chasing enquiries, quotes and deals — and calling new leads fast.",
  booking:      "Filling the diary, confirming what is in it, and rescuing what falls out.",
  support:      "Taking problems down accurately and chasing what people are waiting on.",
  marketing:    "Reviews, feedback, invitations and keeping a list worth calling.",
  ops:          "Internal calls — screening applicants and the like.",
  custom:       "An empty agent. You write everything.",
}

/**
 * One template.
 *
 * `requires` is on the card rather than behind the disclosure, deliberately.
 * Finding out that a template wanted a calendar *after* the first booking call
 * failed is the exact shape of failure this whole platform keeps hitting.
 */
function TemplateCard({
  template: t, applied, onApply,
}: {
  template: AgentTemplate
  applied: boolean
  onApply: (t: AgentTemplate) => void
}) {
  const [open, setOpen] = useState(false)
  const Trade = t.industry ? INDUSTRY_ICON[t.industry] : null

  return (
    <div
      className={cn(
        "rounded-field border px-4 py-3.5 transition-colors",
        applied
          ? "border-brand-500/60 bg-brand-500/12"
          : "border-line bg-field hover:border-line-strong"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[13px] font-medium", applied && "text-brand-on-tint")}>
            {t.name}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] font-light text-subtle">
            <span>{DIRECTION_LABEL[t.direction]}</span>
            {Trade && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Trade size={11} />
                  {INDUSTRY_LABEL[t.industry!]}
                </span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onApply(t)}
          className="shrink-0 rounded-xs border border-line-strong bg-field px-2.5 py-1 text-[11.5px] text-fg transition-colors hover:border-brand-400"
        >
          {applied ? "Applied" : "Use"}
        </button>
      </div>

      <p className="mt-2 text-[12px] font-light leading-relaxed text-muted">{t.summary}</p>

      {t.requires?.length ? (
        <ul className="mt-2 space-y-1">
          {t.requires.map(r => (
            <li key={r} className="flex items-start gap-1.5 text-[11.5px] font-light text-warning">
              <IconWarning size={12} className="mt-0.5 shrink-0" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {t.flow.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-2 flex items-center gap-1 text-[11.5px] text-muted transition-colors hover:text-fg"
          >
            <IconChevron
              size={12}
              className={cn("transition-transform", open && "rotate-180")}
            />
            {open ? "Hide the call flow" : "What does it do?"}
          </button>
          {open && (
            <ol className="mt-2 ml-4 list-decimal space-y-1 text-[11.5px] font-light text-subtle marker:text-subtle">
              {t.flow.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

/**
 * A labelled row of single-choice chips.
 *
 * Generic over the value so the two rows above cannot get their handlers
 * crossed — a plain `string` here compiled fine and let "outbound" be set as an
 * industry.
 */
function ChipRow<T extends string>({
  label, value, onChange, options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: Icon }[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11px] uppercase tracking-[0.1em] text-subtle">
        {label}
      </span>
      {options.map(o => {
        const Glyph = o.icon
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              "flex items-center gap-1.5 rounded-xs border px-2 py-1 text-[11.5px] transition-colors",
              value === o.value
                ? "border-brand-500/50 bg-brand-500/12 text-brand-on-tint"
                : "border-line bg-field text-muted hover:border-line-strong hover:text-fg"
            )}
          >
            {Glyph && <Glyph size={12} />}
            {o.label}
          </button>
        )
      })}
    </div>
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

/**
 * The timezone the preview should show.
 *
 * Mirrors `effectiveTimeZone` on the server — the availability tool's setting,
 * or UTC. Duplicated rather than imported because that module reads the
 * environment and cannot cross into a client component, and getting it wrong
 * here would make the preview lie about the one thing it exists to reveal.
 */
function previewTimeZone(tools: AgentTool[]): string {
  const cal = tools.find(
    (t): t is Extract<AgentTool, { timeZone: string }> =>
      "timeZone" in t && typeof t.timeZone === "string" && t.timeZone.trim() !== ""
  )
  return cal?.timeZone.trim() ?? "UTC"
}
