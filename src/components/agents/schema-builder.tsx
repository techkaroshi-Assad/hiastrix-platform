"use client"

/**
 * "What to pull out", as a form.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────
 *
 * A textarea containing JSON Schema. See `lib/agents/schema-builder.ts` for why
 * that was the wrong thing to hand somebody who runs a roofing company.
 *
 * ── THE ESCAPE HATCH IS NOT OPTIONAL ──────────────────────────────────
 *
 * Some agents already carry schemas somebody wrote by hand, and some of those
 * will use enums or nested objects that this form cannot represent. Rendering
 * one of those as a form and saving it would destroy work silently.
 *
 * So the component asks `fromJsonSchema` first. If the answer is "this is a
 * flat list of fields", it shows the form. If it is anything else, it shows the
 * raw JSON and says which construct it could not display. There is also a
 * manual toggle, because somebody who wants the JSON should not have to break
 * their schema to get at it.
 *
 * ── WHY THE JSON IS STILL THE SOURCE OF TRUTH ─────────────────────────
 *
 * The form does not hold state that the draft does not. Every edit regenerates
 * the schema string and hands it up, and the field rows are derived back from
 * that string on render. One representation, so the two cannot drift — and the
 * JSON tab, which edits the same string directly, stays correct for free.
 */

import { useState } from "react"
import { TextArea, Select, SecondaryButton } from "@/components/ui/form"
import { Field } from "@/components/ui/field"
import { IconPlus, IconDelete, IconWarning, IconInfo } from "@/components/app/icons"
import {
  fromJsonSchema, toJsonSchema, fieldIssues, emptyField,
  STARTER_FIELDS, FIELD_TYPES, toKey,
  type SchemaField,
} from "@/lib/agents/schema-builder"
import { cn } from "@/lib/utils"

export function SchemaBuilder({
  value,
  onChange,
}: {
  /** The JSON Schema string, exactly as it is stored and sent. */
  value: string
  onChange: (next: string) => void
}) {
  const parsed = fromJsonSchema(value)
  const [raw, setRaw] = useState(false)

  /* Forced into the raw editor by content, or asked for by the tenant. The two
   * are distinguished because only one of them has a way back. */
  const forced = !parsed.simple
  const showRaw = forced || raw

  const fields = parsed.simple ? parsed.fields : []
  const issues = fieldIssues(fields)
  const issueAt = (i: number) => issues.find(x => x.index === i)?.message

  function write(next: SchemaField[]) {
    onChange(toJsonSchema(next))
  }

  const patch = (i: number, p: Partial<SchemaField>) =>
    write(fields.map((f, k) => (k === i ? { ...f, ...p } : f)))

  return (
    <div className="space-y-3">
      {showRaw ? (
        <>
          {forced && (
            <p className="flex items-start gap-2 rounded-field border border-warning/30 bg-warning/[0.08] px-3.5 py-2.5 text-[12.5px] font-light leading-relaxed text-muted">
              <IconWarning size={14} className="mt-0.5 shrink-0 text-warning" />
              <span>
                {parsed.reason} Nothing here is changed by opening it — the form is
                just not able to show it.
              </span>
            </p>
          )}

          <TextArea
            label="What to pull out (JSON Schema)"
            rows={10}
            value={value}
            onChange={e => onChange(e.target.value)}
            hint="Written straight through to the provider. Blank means extraction returns nothing."
          />

          {!forced && (
            <SecondaryButton type="button" onClick={() => setRaw(false)}>
              Back to the field list
            </SecondaryButton>
          )}
        </>
      ) : (
        <>
          {fields.length === 0 ? (
            /* An empty form is only marginally better than an empty JSON box:
               it removes the syntax problem and leaves "what am I supposed to
               put here" untouched. */
            <div className="rounded-field border border-line bg-field px-4 py-5 text-center">
              <p className="text-[13px] text-muted">
                Nothing is being pulled out yet.
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[12px] font-light leading-relaxed text-subtle">
                Name the things you want off every call — a budget, a postcode, whether
                they want a callback — and they&rsquo;ll appear on the call record and in
                your reports.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <SecondaryButton type="button" onClick={() => write(STARTER_FIELDS)}>
                  Start with three common ones
                </SecondaryButton>
                <SecondaryButton type="button" onClick={() => write([emptyField()])}>
                  Add a field
                </SecondaryButton>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {fields.map((f, i) => {
                const problem = issueAt(i)
                const key = toKey(f.name)
                return (
                  <li
                    key={i}
                    className={cn(
                      "rounded-field border px-4 py-3.5",
                      problem ? "border-warning/30 bg-warning/[0.06]" : "border-line bg-field"
                    )}
                  >
                    <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
                      <Field
                        label="Call it"
                        value={f.name}
                        onChange={e => patch(i, { name: e.target.value })}
                        placeholder="Budget"
                        // The generated key, shown rather than explained. It is
                        // what appears in exports and in the call record, and a
                        // tenant who never sees it is surprised by it later.
                        hint={key ? `Saved as ${key}` : undefined}
                      />
                      <Select
                        label="Kind of answer"
                        value={f.type}
                        onChange={e => patch(i, { type: e.target.value as SchemaField["type"] })}
                        options={FIELD_TYPES.map(t => ({ value: t.value, label: t.label }))}
                        hint={FIELD_TYPES.find(t => t.value === f.type)?.example}
                      />
                    </div>

                    <div className="mt-3">
                      <Field
                        label="What to look for"
                        value={f.description}
                        onChange={e => patch(i, { description: e.target.value })}
                        placeholder="Roughly what they said they wanted to spend."
                        hint="The only instruction the model gets about what this field means."
                      />
                    </div>

                    {problem && (
                      <p className="mt-2 text-[12px] font-light text-warning">{problem}</p>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={e => patch(i, { required: e.target.checked })}
                          className="h-3.5 w-3.5 accent-[var(--brand-500)]"
                        />
                        Always try to get this
                      </label>

                      <button
                        type="button"
                        onClick={() => write(fields.filter((_, k) => k !== i))}
                        className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-[11.5px] text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <IconDelete size={13} />
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {fields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton type="button" onClick={() => write([...fields, emptyField()])}>
                <IconPlus size={14} />
                Add a field
              </SecondaryButton>
              <SecondaryButton type="button" onClick={() => setRaw(true)}>
                Edit as JSON
              </SecondaryButton>
            </div>
          )}

          {/* "Always try to get this" is not a guarantee and must not read as
              one. A caller who hangs up early cannot be made to answer. */}
          {fields.some(f => f.required) && (
            <p className="flex items-start gap-2 text-[12px] font-light leading-relaxed text-subtle">
              <IconInfo size={13} className="mt-0.5 shrink-0" />
              <span>
                &ldquo;Always try to get this&rdquo; tells the agent to prioritise the
                answer. It can&rsquo;t force one — a caller who rings off early still
                rings off early, and the field comes back empty.
              </span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
