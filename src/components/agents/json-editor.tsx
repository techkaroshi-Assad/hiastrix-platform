"use client"

/**
 * Agent-as-JSON editor.
 *
 * Deliberately a plain textarea — a code-editor dependency would add hundreds of
 * kilobytes to every dashboard page for a panel most tenants never open.
 *
 * The two-way sync has one non-obvious rule: we never write the parsed object
 * back into the text while the user is typing. Zod fills defaults on parse, so
 * re-serialising would inject keys they did not type and move the caret. The
 * text is only regenerated on Format, and when the tab is opened.
 */

import { useEffect, useRef, useState } from "react"
import { ErrorNote, InfoNote } from "@/components/ui/field"
import { SecondaryButton } from "@/components/ui/form"
import { AgentJsonSchema, firstIssue } from "@/lib/vapi/agent"
import type { AgentConfig } from "@/lib/vapi/config"

export type AgentDraft = {
  name: string
  systemPrompt: string
  firstMessage: string
  voice: string
  model: string
  recordingEnabled: boolean
  transcriptionEnabled: boolean
  config: AgentConfig
}

const serialise = (draft: AgentDraft) => JSON.stringify(draft, null, 2)

export function JsonEditor({
  draft,
  onChange,
  onValidityChange,
}: {
  draft: AgentDraft
  onChange: (next: AgentDraft) => void
  onValidityChange: (valid: boolean) => void
}) {
  const [text, setText] = useState(() => serialise(draft))
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending parse when the tab closes, so a stale keystroke can't
  // land on a draft the user has since abandoned.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function handle(next: string) {
    setText(next)
    if (timer.current) clearTimeout(timer.current)

    timer.current = setTimeout(() => {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(next)
      } catch (e) {
        setError(e instanceof Error ? e.message : "That isn't valid JSON.")
        onValidityChange(false)
        return
      }

      const result = AgentJsonSchema.safeParse(parsedJson)
      if (!result.success) {
        setError(firstIssue(result.error))
        onValidityChange(false)
        return
      }

      setError(null)
      onValidityChange(true)
      onChange(result.data as AgentDraft)
    }, 250)
  }

  return (
    <div className="space-y-3">
      <InfoNote>
        Webhook, billing and status are managed by Hi-Astrix and aren&rsquo;t part of this
        file. Everything you can set in the form is here.
      </InfoNote>

      {error && <ErrorNote>{error}</ErrorNote>}

      <textarea
        value={text}
        onChange={e => handle(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={26}
        aria-label="Agent configuration as JSON"
        className={[
          "w-full resize-y rounded-field border bg-field px-3.5 py-3",
          "font-mono text-[12.5px] leading-relaxed text-fg",
          "outline-none transition-colors",
          error ? "border-danger/50" : "border-line hover:border-line-strong",
          "focus:border-brand-500/65",
        ].join(" ")}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-subtle">
          {error
            ? "Fix the problem above to switch back to the form."
            : "Valid — your changes are applied."}
        </p>
        <SecondaryButton
          type="button"
          onClick={() => {
            setText(serialise(draft))
            setError(null)
            onValidityChange(true)
          }}
        >
          Reformat
        </SecondaryButton>
      </div>
    </div>
  )
}
