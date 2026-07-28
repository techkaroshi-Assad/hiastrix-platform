"use client"

/**
 * Tools editor — CRM actions and custom functions.
 *
 * Two blocks, because they behave differently. CRM actions are singletons the
 * tenant switches on and off; custom functions are a list they build.
 *
 * Every id field here is a dropdown fed from the tenant's own sub-account —
 * their calendars, their pipelines, their tags, their custom fields. Nobody
 * should be asked to paste an identifier they would have to go and find, and a
 * picker also means a typo cannot reach the model as a silently broken tool.
 *
 * The connection itself is set up once by Hi-Astrix. There is deliberately no
 * credential field here — only which actions this agent is allowed to take.
 */

import { useEffect, useState } from "react"
import { Field, ErrorNote, InfoNote } from "@/components/ui/field"
import { TextArea, Select, Toggle, SecondaryButton, DangerButton } from "@/components/ui/form"
import {
  CRM_GROUPS,
  CRM_TOOLS,
  TIME_ZONES,
  TOOL_PARAM_TYPES,
  BOOKING_PREREQUISITES,
  BOOKING_PREREQ_MESSAGE,
  blankFunctionTool,
  defaultCrmTool,
  findTool,
  removeToolType,
  toolIssues,
  upsertTool,
  type AgentTool,
  type AgentToolType,
  type CrmToolSpec,
  type ToolParameter,
} from "@/lib/vapi/tools"
import { enforcedRules, suggestedFlow } from "@/lib/crm/guidance"
import { cn } from "@/lib/utils"

/* ── What the tenant's own sub-account contains ────────────────────────── */

type CrmOptions = {
  linked: boolean
  calendars: { id: string; name: string }[]
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[]
  tags: string[]
  fields: { id: string; name: string }[]
}

const NO_OPTIONS: CrmOptions = {
  linked: false, calendars: [], pipelines: [], tags: [], fields: [],
}

function useCrmOptions() {
  const [options, setOptions] = useState<CrmOptions>(NO_OPTIONS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    fetch("/api/crm/options")
      .then(r => (r.ok ? r.json() : NO_OPTIONS))
      .then(data => { if (live) setOptions(data as CrmOptions) })
      .catch(() => { if (live) setOptions(NO_OPTIONS) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  return { options, loading }
}

/** Stage and tag names routinely carry emoji. Fine in a dropdown, noise in a
 *  label — and the model never sees these at all, only their resolved ids. */
const clean = (s: string) =>
  s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").trim() || s

/* ── Editor ────────────────────────────────────────────────────────────── */

export function ToolsEditor({
  value,
  onChange,
  onAddGuidance,
}: {
  value: AgentTool[]
  onChange: (next: AgentTool[]) => void
  /** Appends a draft call flow to the agent's instructions. Optional so the
   *  editor still works anywhere the prompt is not in reach. */
  onAddGuidance?: (text: string) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  const { options, loading } = useCrmOptions()

  const issues = toolIssues(value)
  const functions = value.filter(t => t.type === "function")
  const crmOn = value.some(t => t.type.startsWith("crm."))
  const [added, setAdded] = useState(false)

  /* ── CRM actions ─────────────────────────────────────────────────── */

  function toggleCrm(spec: CrmToolSpec, on: boolean) {
    setNote(null)

    if (on) {
      let next = upsertTool(value, seed(spec, options))

      // Booking is meaningless without a contact to book for, so switch the
      // prerequisites on rather than letting the tenant hit a rejection.
      if (spec.type === "crm.appointment.book") {
        const missing = BOOKING_PREREQUISITES.filter(t => !findTool(next, t))
        for (const type of missing) {
          const prereq = CRM_TOOLS.find(g => g.type === type)
          if (prereq) next = upsertTool(next, seed(prereq, options))
        }
        if (missing.length) setNote(BOOKING_PREREQ_MESSAGE)
      }

      // Everything that acts on a contact needs one found first.
      if (spec.type !== "crm.contact.find" && spec.type !== "crm.appointment.availability") {
        if (!findTool(next, "crm.contact.find")) {
          const lookup = CRM_TOOLS.find(g => g.type === "crm.contact.find")
          if (lookup) {
            next = upsertTool(next, seed(lookup, options))
            setNote(
              "“Look up a contact” was switched on too — every other CRM action needs a contact to act on."
            )
          }
        }
      }

      onChange(next)
      return
    }

    // Blocked rather than silently allowed — the server would reject it anyway.
    if (BOOKING_PREREQUISITES.includes(spec.type) && findTool(value, "crm.appointment.book")) {
      setNote(BOOKING_PREREQ_MESSAGE)
      return
    }
    if (spec.type === "crm.contact.find") {
      const dependants = value.filter(
        t => t.type.startsWith("crm.") &&
             t.type !== "crm.contact.find" &&
             t.type !== "crm.appointment.availability"
      )
      if (dependants.length) {
        setNote("Turn the other CRM actions off first — they all need a contact to act on.")
        return
      }
    }

    onChange(removeToolType(value, spec.type))
  }

  function patchCrm(type: AgentToolType, patch: Record<string, unknown>) {
    const existing = findTool(value, type)
    if (!existing) return
    onChange(upsertTool(value, { ...existing, ...patch } as AgentTool))
  }

  /* ── Custom functions ────────────────────────────────────────────── */

  function patchFunction(index: number, patch: Partial<Extract<AgentTool, { type: "function" }>>) {
    let seen = -1
    onChange(
      value.map(t => {
        if (t.type !== "function") return t
        seen++
        return seen === index ? { ...t, ...patch } : t
      })
    )
  }

  function removeFunction(index: number) {
    let seen = -1
    onChange(
      value.filter(t => {
        if (t.type !== "function") return true
        seen++
        return seen !== index
      })
    )
  }

  return (
    <div className="space-y-6">
      {note && <InfoNote>{note}</InfoNote>}
      {issues.map((issue, i) => (
        <ErrorNote key={i}>{issue.message}</ErrorNote>
      ))}

      {/* ── CRM ──────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <div>
          <h4 className="text-[13px] font-semibold">CRM actions</h4>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            Let this agent read and write your CRM mid-call. The connection is set up
            once by Hi-Astrix — you only choose what this agent may do.
          </p>
        </div>

        {!loading && !options.linked ? (
          <InfoNote>
            This workspace isn&rsquo;t linked to a CRM yet, so these actions are
            unavailable. Ask the Hi-Astrix team to connect it and they&rsquo;ll appear
            here.
          </InfoNote>
        ) : (
          CRM_GROUPS.map(group => (
            <div key={group.key} className="space-y-2.5">
              <div>
                <h5 className="text-[12.5px] font-semibold text-muted">{group.title}</h5>
                <p className="mt-0.5 text-xs leading-relaxed text-subtle">{group.blurb}</p>
              </div>

              {CRM_TOOLS.filter(spec => spec.group === group.key).map(spec => {
                const tool = findTool(value, spec.type)
                const on = Boolean(tool)

                return (
                  <div key={spec.type} className="space-y-2.5">
                    <Toggle
                      label={spec.label}
                      description={spec.blurb}
                      checked={on}
                      disabled={loading}
                      onChange={next => toggleCrm(spec, next)}
                    />

                    {on && tool && (
                      <CrmToolSettings
                        spec={spec}
                        tool={tool}
                        options={options}
                        onPatch={patch => patchCrm(spec.type, patch)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* ── Behaviour ────────────────────────────────────────────── */}
      {crmOn && (
        <div className="space-y-3 rounded-field border border-line bg-field-soft p-4">
          <div>
            <h5 className="text-[12.5px] font-semibold">Making the agent actually use these</h5>
            <p className="mt-1 text-xs leading-relaxed text-subtle">
              Switching an action on gives the agent the ability to do it. What it
              does on a call, and in what order, comes from its instructions.
            </p>
          </div>

          <details className="group">
            <summary className="cursor-pointer list-none text-xs text-muted underline-offset-4 hover:underline">
              Hi-Astrix already enforces a few rules — see them
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-field border border-line bg-field px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-subtle">
              {enforcedRules(value).replace(/^\n+/, "")}
            </pre>
            <p className="mt-1.5 text-xs leading-relaxed text-subtle">
              These are added to every call automatically and can&rsquo;t be removed —
              they&rsquo;re what stops duplicate contacts and appointments that were
              never really free.
            </p>
          </details>

          {onAddGuidance && (
            <div className="space-y-2">
              <SecondaryButton
                type="button"
                onClick={() => {
                  onAddGuidance(suggestedFlow(value))
                  setAdded(true)
                }}
              >
                {added ? "Added to instructions" : "Add a suggested call flow"}
              </SecondaryButton>
              <p className="text-xs leading-relaxed text-subtle">
                Drops a step-by-step outline into this agent&rsquo;s instructions, built
                from the actions above. Edit it freely afterwards — it&rsquo;s a
                starting point, not a rule.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Custom ───────────────────────────────────────────────── */}
      <div className="space-y-3 border-t border-line pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-[13px] font-semibold">Custom tools</h4>
            <p className="mt-1 text-xs leading-relaxed text-subtle">
              Give the agent an action of your own — look up an order, check stock,
              raise a ticket. It calls your endpoint mid-conversation and speaks the
              answer.
            </p>
          </div>
          <SecondaryButton
            type="button"
            onClick={() => onChange([...value, blankFunctionTool(functions.length)])}
          >
            Add tool
          </SecondaryButton>
        </div>

        {functions.map((tool, i) => {
          const fn = tool as Extract<AgentTool, { type: "function" }>
          return (
            <FunctionCard
              key={i}
              tool={fn}
              onPatch={patch => patchFunction(i, patch)}
              onRemove={() => removeFunction(i)}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * A newly switched-on action, pre-filled with the obvious choice.
 *
 * With exactly one calendar or one pipeline there is no decision to make, so
 * making the tenant open a select to confirm it is pure friction — and a tool
 * saved with an empty id is a tool that fails on its first call.
 */
function seed(spec: CrmToolSpec, options: CrmOptions): AgentTool {
  const tool = defaultCrmTool(spec)

  if (spec.needsCalendar && options.calendars.length === 1) {
    return { ...tool, calendarId: options.calendars[0].id } as AgentTool
  }
  if (spec.needsPipeline && options.pipelines.length === 1) {
    return { ...tool, pipelineId: options.pipelines[0].id } as AgentTool
  }
  return tool
}

/* ── Per-action settings ───────────────────────────────────────────── */

function CrmToolSettings({
  spec,
  tool,
  options,
  onPatch,
}: {
  spec: CrmToolSpec
  tool: AgentTool
  options: CrmOptions
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const anything =
    spec.needsCalendar || spec.needsTimeZone || spec.needsPipeline ||
    spec.needsTags || spec.needsFields
  if (!anything) return null

  const t = tool as Record<string, unknown>
  const pipeline = options.pipelines.find(p => p.id === t.pipelineId)

  return (
    <div className="ml-1 space-y-3 border-l border-line pl-4">
      {spec.needsCalendar && (
        <Select
          label="Calendar"
          value={String(t.calendarId ?? "")}
          onChange={e => onPatch({ calendarId: e.target.value })}
          options={options.calendars.map(c => ({ value: c.id, label: clean(c.name) }))}
          placeholder={
            options.calendars.length ? "Choose a calendar" : "No calendars in your CRM yet"
          }
          hint="Only this calendar is read from and booked into."
        />
      )}

      {spec.needsTimeZone && (
        <Select
          label="Time zone"
          value={String(t.timeZone ?? "UTC")}
          onChange={e => onPatch({ timeZone: e.target.value })}
          options={TIME_ZONES.map(tz => ({ value: tz, label: tz }))}
          hint="Slots are offered to callers in this zone."
        />
      )}

      {spec.needsPipeline && (
        <>
          <Select
            label="Pipeline"
            value={String(t.pipelineId ?? "")}
            onChange={e => onPatch({ pipelineId: e.target.value })}
            options={options.pipelines.map(p => ({ value: p.id, label: clean(p.name) }))}
            placeholder={
              options.pipelines.length ? "Choose a pipeline" : "No pipelines in your CRM yet"
            }
          />
          {pipeline && (
            <p className="text-xs leading-relaxed text-subtle">
              The agent can move deals between{" "}
              <span className="text-muted">
                {pipeline.stages.map(s => clean(s.name)).join(", ")}
              </span>
              .
            </p>
          )}
        </>
      )}

      {spec.needsTags && (
        <CheckList
          label="Tags this agent may use"
          hint="Leaving all of these unticked lets the agent use any tag, which is rarely what you want — pick the ones your workflows listen for."
          empty="No tags in your CRM yet."
          options={options.tags.map(name => ({ value: name, label: clean(name) }))}
          selected={(t.tags as string[]) ?? []}
          onChange={next => onPatch({ tags: next })}
        />
      )}

      {spec.needsFields && (
        <CheckList
          label="Fields this agent may fill in"
          hint="The agent is offered these by name and can write nothing else."
          empty="No custom contact fields in your CRM yet."
          options={options.fields.map(f => ({ value: f.id, label: f.name }))}
          selected={((t.fields as { id: string }[]) ?? []).map(f => f.id)}
          onChange={next =>
            onPatch({
              fields: next.map(id => ({
                id,
                name: options.fields.find(f => f.id === id)?.name ?? id,
              })),
            })
          }
        />
      )}
    </div>
  )
}

/** A short multi-select. A native multiple-select is unusable with a trackpad,
 *  and these lists are small enough to show in full. */
function CheckList({
  label,
  hint,
  empty,
  options,
  selected,
  onChange,
}: {
  label: string
  hint: string
  empty: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]
    )

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-muted">{label}</span>

      {options.length === 0 ? (
        <p className="text-xs text-subtle">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map(o => {
            const on = selected.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] transition-colors",
                  on
                    ? "border-brand-500/60 bg-brand-500/12 text-brand-on-tint"
                    : "border-line text-subtle hover:border-line-strong hover:text-fg"
                )}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-subtle">{hint}</p>
    </div>
  )
}

/* ── One custom tool ───────────────────────────────────────────────── */

function FunctionCard({
  tool,
  onPatch,
  onRemove,
}: {
  tool: Extract<AgentTool, { type: "function" }>
  onPatch: (patch: Partial<Extract<AgentTool, { type: "function" }>>) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  const setParam = (i: number, patch: Partial<ToolParameter>) =>
    onPatch({ parameters: tool.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  return (
    <div className="space-y-4 rounded-field border border-line bg-field p-4">
      <Field
        label="Tool name"
        value={tool.name}
        onChange={e => onPatch({ name: e.target.value })}
        placeholder="check_order_status"
        hint="How the model refers to it. Letters, numbers and underscores."
      />

      <TextArea
        label="When should the agent use this?"
        rows={2}
        value={tool.description}
        onChange={e => onPatch({ description: e.target.value })}
        placeholder="Look up the status of a customer's order using their order number."
        hint="The model decides whether to call the tool based on this sentence, so be specific."
      />

      <Field
        label="Endpoint URL"
        value={tool.serverUrl}
        onChange={e => onPatch({ serverUrl: e.target.value })}
        placeholder="https://api.yourcompany.com/order-status"
        hint="We POST the arguments here and speak your JSON response back to the caller."
      />

      <Field
        label="Shared secret (optional)"
        value={tool.serverSecret}
        onChange={e => onPatch({ serverSecret: e.target.value })}
        placeholder="Sent as x-tool-secret so you can verify the request"
        hint="Visible to everyone in your workspace."
      />

      <Field
        label="Holding phrase (optional)"
        value={tool.waitingMessage}
        onChange={e => onPatch({ waitingMessage: e.target.value })}
        placeholder="Let me check that for you…"
        hint="Spoken while your endpoint responds, so the caller isn't left in silence."
      />

      {/* Parameters */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted">
            Information to collect ({tool.parameters.length})
          </span>
          <SecondaryButton
            type="button"
            className="h-8 px-3 text-[12px]"
            onClick={() =>
              onPatch({
                parameters: [
                  ...tool.parameters,
                  { name: "", type: "string", description: "", required: false },
                ],
              })
            }
          >
            Add field
          </SecondaryButton>
        </div>

        {tool.parameters.length === 0 ? (
          <p className="text-xs text-subtle">
            No fields — the agent will call this tool with no arguments.
          </p>
        ) : (
          tool.parameters.map((p, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-field border border-line p-3 sm:grid-cols-[1fr_120px]"
            >
              <Field
                label="Field name"
                value={p.name}
                onChange={e => setParam(i, { name: e.target.value })}
                placeholder="order_number"
              />
              <Select
                label="Type"
                value={p.type}
                onChange={e => setParam(i, { type: e.target.value as ToolParameter["type"] })}
                options={TOOL_PARAM_TYPES.map(t => ({ value: t, label: t }))}
              />
              <div className="sm:col-span-2">
                <Field
                  label="What is it?"
                  value={p.description}
                  onChange={e => setParam(i, { description: e.target.value })}
                  placeholder="The customer's order reference, e.g. AB-12345"
                />
              </div>
              <div className="sm:col-span-2">
                <Toggle
                  label="Required"
                  description="The agent will keep asking until the caller provides it."
                  checked={p.required}
                  onChange={v => setParam(i, { required: v })}
                />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    onPatch({ parameters: tool.parameters.filter((_, j) => j !== i) })
                  }
                  className="text-[12px] text-subtle transition-colors hover:text-danger"
                >
                  Remove field
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={cn("flex items-center justify-end gap-2 border-t border-line pt-3")}>
        {confirming ? (
          <>
            <span className="text-[12.5px] text-muted">Remove this tool?</span>
            <SecondaryButton type="button" onClick={() => setConfirming(false)}>
              Cancel
            </SecondaryButton>
            <DangerButton type="button" onClick={onRemove}>
              Remove
            </DangerButton>
          </>
        ) : (
          <DangerButton type="button" onClick={() => setConfirming(true)}>
            Remove tool
          </DangerButton>
        )}
      </div>
    </div>
  )
}
