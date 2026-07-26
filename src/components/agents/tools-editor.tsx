"use client"

/**
 * Tools editor — CRM integrations and custom functions.
 *
 * Two blocks, because they behave differently. Integrations are singletons the
 * tenant switches on and off; custom functions are a list they build.
 *
 * The CRM credential is connected once by Hi-Astrix upstream, not per tenant,
 * so there is deliberately no credential field here — only which actions this
 * agent is allowed to take.
 */

import { useState } from "react"
import { Field, ErrorNote, InfoNote } from "@/components/ui/field"
import { TextArea, Select, Toggle, SecondaryButton, DangerButton } from "@/components/ui/form"
import {
  GHL_TOOLS,
  TIME_ZONES,
  TOOL_PARAM_TYPES,
  BOOKING_PREREQUISITES,
  BOOKING_PREREQ_MESSAGE,
  blankFunctionTool,
  defaultGhlTool,
  findTool,
  removeToolType,
  toolIssues,
  upsertTool,
  type AgentTool,
  type AgentToolType,
  type GhlToolSpec,
  type ToolParameter,
} from "@/lib/vapi/tools"
import { cn } from "@/lib/utils"

export function ToolsEditor({
  value,
  onChange,
}: {
  value: AgentTool[]
  onChange: (next: AgentTool[]) => void
}) {
  const [note, setNote] = useState<string | null>(null)

  const issues = toolIssues(value)
  const functions = value.filter(t => t.type === "function")

  /* ── Integrations ────────────────────────────────────────────────── */

  function toggleGhl(spec: GhlToolSpec, on: boolean) {
    setNote(null)

    if (on) {
      let next = upsertTool(value, defaultGhlTool(spec))

      // Booking is meaningless without a contact to book for, so switch the
      // prerequisites on rather than letting the tenant hit a rejection.
      if (spec.type === "gohighlevel.calendar.event.create") {
        const missing = BOOKING_PREREQUISITES.filter(t => !findTool(next, t))
        for (const type of missing) {
          const prereq = GHL_TOOLS.find(g => g.type === type)
          if (prereq) next = upsertTool(next, defaultGhlTool(prereq))
        }
        if (missing.length) setNote(BOOKING_PREREQ_MESSAGE)
      }

      onChange(next)
      return
    }

    // Blocked rather than silently allowed — the server would reject it anyway.
    if (
      BOOKING_PREREQUISITES.includes(spec.type) &&
      findTool(value, "gohighlevel.calendar.event.create")
    ) {
      setNote(BOOKING_PREREQ_MESSAGE)
      return
    }

    onChange(removeToolType(value, spec.type))
  }

  function patchGhl(type: AgentToolType, patch: Record<string, string>) {
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
      <div className="space-y-3">
        <div>
          <h4 className="text-[13px] font-semibold">CRM actions</h4>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            Let this agent read and write your CRM mid-call. The connection itself is
            set up once by Hi-Astrix — you only choose what this agent may do.
          </p>
        </div>

        {GHL_TOOLS.map(spec => {
          const tool = findTool(value, spec.type)
          const on = Boolean(tool)

          return (
            <div key={spec.type} className="space-y-2.5">
              <Toggle
                label={spec.label}
                description={spec.blurb}
                checked={on}
                onChange={next => toggleGhl(spec, next)}
              />

              {on && (spec.needsCalendar || spec.needsTimeZone) && (
                <div className="ml-1 space-y-3 border-l border-line pl-4">
                  {spec.needsCalendar && (
                    <Field
                      label="Calendar ID"
                      value={(tool as { calendarId?: string }).calendarId ?? ""}
                      onChange={e => patchGhl(spec.type, { calendarId: e.target.value })}
                      placeholder="The calendar this agent books into"
                      hint="Found in your CRM's calendar settings."
                    />
                  )}
                  {spec.needsTimeZone && (
                    <Select
                      label="Time zone"
                      value={(tool as { timeZone?: string }).timeZone ?? "UTC"}
                      onChange={e => patchGhl(spec.type, { timeZone: e.target.value })}
                      options={TIME_ZONES.map(tz => ({ value: tz, label: tz }))}
                      hint="Slots are offered to callers in this zone."
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

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
