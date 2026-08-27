"use client"

/**
 * Documents an agent can answer from — SERVER round trip on every action,
 * unlike everything else in the editor.
 *
 * Every other field here is local draft state that only reaches the server
 * when the whole form is saved. This can't work that way: uploading a file or
 * fetching a page has to happen against `/api/agents/[id]/knowledge` the
 * moment it's asked for, because that route is what actually talks to the
 * provider and rebuilds the search tool. `onChange` exists purely to keep the
 * editor's own draft in sync with what the server just did — without it, an
 * unrelated Save a minute later would re-send the *stale* file list and wipe
 * out whatever was just added, since the main save route replaces the whole
 * config object.
 */

import { useRef, useState } from "react"
import { Field, ErrorNote } from "@/components/ui/field"
import { SecondaryButton } from "@/components/ui/form"
import { IconDelete } from "@/components/app/icons"
import type { KnowledgeFile } from "@/lib/vapi/config"

export function KnowledgeEditor({
  agentId,
  files,
  onChange,
}: {
  /** Undefined until the agent has been saved once — there is nothing yet to
   *  attach a document to. */
  agentId?: string
  files: KnowledgeFile[]
  /** Called with both together, straight from the server response — never
   *  patched piecemeal, so the two can't fall out of step. */
  onChange: (files: KnowledgeFile[], knowledgeToolId: string) => void
}) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [url, setUrl] = useState("")
  /** "upload" | "url" | a file's own id while it's being removed | null */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!agentId) {
    return (
      <p className="text-[13px] font-light text-muted">
        Save this agent once first — then come back here to give it documents.
      </p>
    )
  }

  async function send(body: FormData | { url: string }) {
    setError(null)
    try {
      const res = await fetch(`/api/agents/${agentId}/knowledge`, {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.")
        return
      }
      onChange(data.files as KnowledgeFile[], data.knowledgeToolId as string)
    } catch {
      setError("Something went wrong. Please try again.")
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy("upload")
    const form = new FormData()
    form.append("file", file)
    await send(form)
    setBusy(null)
    if (fileInput.current) fileInput.current.value = ""
  }

  async function addUrl() {
    const value = url.trim()
    if (!value) return
    setBusy("url")
    await send({ url: value })
    setBusy(null)
    setUrl("")
  }

  async function remove(fileId: string) {
    setError(null)
    setBusy(fileId)
    try {
      const res = await fetch(
        `/api/agents/${agentId}/knowledge?fileId=${encodeURIComponent(fileId)}`,
        { method: "DELETE" }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.")
        return
      }
      onChange(data.files as KnowledgeFile[], data.knowledgeToolId as string)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      {files.length > 0 && (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-field border border-line">
          {files.map(f => (
            <li key={f.id} className="flex items-center justify-between gap-3 bg-field px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-fg">{f.name}</p>
                <p className="text-[11.5px] text-subtle">
                  {f.source === "url" ? "From a web page" : "Uploaded file"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(f.id)}
                disabled={busy !== null}
                aria-label={`Remove ${f.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-field-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === f.id ? "…" : <IconDelete size={15} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <SecondaryButton
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null}
        >
          {busy === "upload" ? "Uploading…" : "Upload a document"}
        </SecondaryButton>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.pdf,.doc,.docx,.csv,.md,.tsv,.yaml,.yml,.json,.xml,.log"
          className="sr-only"
          onChange={onPickFile}
        />
        <p className="mt-1.5 text-[12px] font-light text-subtle">
          Text, PDF, Word, or a spreadsheet export, under 300KB.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="Or a web page"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://your-site.com/pricing"
            hint="The page's text is pulled in once — editing the page later doesn't update this."
          />
        </div>
        <SecondaryButton type="button" onClick={addUrl} disabled={busy !== null || !url.trim()}>
          {busy === "url" ? "Adding…" : "Add"}
        </SecondaryButton>
      </div>
    </div>
  )
}
