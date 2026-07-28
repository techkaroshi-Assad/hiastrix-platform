"use client"

/**
 * Running a campaign: start, pause, archive, and getting people into it.
 *
 * The upload is the interesting part. A spreadsheet is parsed here, in the
 * browser, and only clean rows are sent — which means the file never crosses the
 * network, a forty-thousand-row export is read on the machine that already has
 * it, and the person gets to confirm which column is the phone number before a
 * single call exists. It also keeps every request in this codebase JSON; there
 * is no multipart route anywhere and this did not need to be the first.
 */

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Select, SecondaryButton, DangerButton, Panel } from "@/components/ui/form"
import { parseCsv, guessColumns, toImportRows, type ColumnGuess } from "@/lib/dialer/csv"
import { cn } from "@/lib/utils"

export function leadTone(state: string): "neutral" | "success" | "warning" | "danger" | "brand" {
  switch (state) {
    case "COMPLETED":   return "success"
    case "DIALING":
    case "IN_PROGRESS": return "brand"
    case "RETRY_WAIT":
    case "DEFERRED":    return "warning"
    case "FAILED":
    case "SUPPRESSED":  return "danger"
    default:            return "neutral"
  }
}

/* ── Live refresh ──────────────────────────────────────────────────────── */

/**
 * The first polling in this app, and deliberately the cheapest kind.
 *
 * `router.refresh()` re-runs the server component and streams fresh HTML.
 * Everything on this page is already server-rendered with `force-dynamic`, so
 * there is nothing to keep in sync and no data-fetching library to add — the
 * numbers simply redraw.
 *
 * Five seconds while the tab is visible, and nothing at all when it is not:
 * a campaign left open in a background tab overnight would otherwise make
 * seventeen thousand requests to watch a progress bar nobody is looking at.
 */
export function LiveRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) return
      timer = setInterval(() => startTransition(() => router.refresh()), everyMs)
    }
    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") { router.refresh(); start() }
      else stop()
    }

    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)

    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility) }
  }, [router, everyMs, startTransition])

  return null
}

/* ── Controls ──────────────────────────────────────────────────────────── */

export function CampaignControls({
  id,
  state,
  notReadyReason,
  hasLeads,
}: {
  id: string
  state: string
  notReadyReason: string | null
  hasLeads: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  async function act(action: "start" | "pause" | "archive") {
    setError(null)
    setBusy(action)
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setConfirmArchive(false)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  const canStart = hasLeads && !notReadyReason && state !== "ARCHIVED"

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {state !== "ARCHIVED" && (
          <SecondaryButton
            type="button"
            onClick={() => setConfirmArchive(true)}
            disabled={busy !== null}
          >
            Archive
          </SecondaryButton>
        )}

        {state === "RUNNING" ? (
          <SecondaryButton
            type="button"
            onClick={() => act("pause")}
            disabled={busy !== null}
            className="border-warning/40 text-warning"
          >
            {busy === "pause" ? "Pausing…" : "Pause"}
          </SecondaryButton>
        ) : (
          <SubmitButton
            type="button"
            sheen={false}
            className="w-auto px-5"
            loading={busy === "start"}
            disabled={!canStart || busy !== null}
            title={
              !hasLeads ? "Add some people first." : notReadyReason ?? undefined
            }
            onClick={() => act("start")}
          >
            {state === "PAUSED" ? "Resume" : "Start calling"}
          </SubmitButton>
        )}
      </div>

      {error && <span className="text-[11.5px] text-danger">{error}</span>}

      <Panel
        open={confirmArchive}
        title="Archive this campaign?"
        subtitle="Anyone still waiting to be called is cancelled. Calls already connected will finish. This can't be undone."
        onClose={() => setConfirmArchive(false)}
        footer={
          <div className="flex justify-end gap-2">
            <SecondaryButton type="button" onClick={() => setConfirmArchive(false)}>
              Keep it
            </SecondaryButton>
            <DangerButton type="button" onClick={() => act("archive")} disabled={busy !== null}>
              {busy === "archive" ? "Archiving…" : "Archive"}
            </DangerButton>
          </div>
        }
      >
        <p className="text-[13px] font-light text-muted">
          The record of who was called and what happened stays in your call history.
          What goes is the queue of people it had not got to yet.
        </p>
      </Panel>
    </div>
  )
}

/* ── Import ────────────────────────────────────────────────────────────── */

type Report = {
  received: number
  added: number
  duplicate: number
  duplicateInFile: number
  suppressed: number
  invalid: { row: number; value: string; reason: string }[]
}

const emptyReport = (): Report => ({
  received: 0, added: 0, duplicate: 0, duplicateInFile: 0, suppressed: 0, invalid: [],
})

/** Chunks match the server's own limit, so nothing is rejected for being big. */
const CHUNK = 1000

export function LeadImport({
  campaignId,
  crmConnected,
  countryCode,
  compact,
}: {
  campaignId: string
  crmConnected: boolean
  countryCode: string
  compact?: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const fileInput = useRef<HTMLInputElement | null>(null)

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"file" | "crm">("file")

  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [ragged, setRagged] = useState<{ line: number; got: number }[]>([])
  const [map, setMap] = useState<ColumnGuess | null>(null)
  const [fileName, setFileName] = useState("")

  const [crmTag, setCrmTag] = useState("")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  function reset() {
    setHeaders([]); setRows([]); setRagged([]); setMap(null); setFileName("")
    setReport(null); setError(null); setProgress(null); setCrmTag("")
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setReport(null)

    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (!parsed.headers.length || !parsed.rows.length) {
        setError("That file doesn't seem to have a header row and any data under it.")
        return
      }
      setFileName(file.name)
      setHeaders(parsed.headers)
      setRows(parsed.rows)
      setRagged(parsed.ragged)
      setMap(guessColumns(parsed.headers))
    } catch {
      setError("We couldn't read that file. It needs to be a CSV.")
    } finally {
      // Cleared so choosing the same file twice still fires a change event.
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  async function upload() {
    if (!map || map.phone === null) {
      setError("Tell us which column holds the phone number.")
      return
    }
    setBusy(true); setError(null)

    const all = toImportRows({ headers, rows, ragged }, map)
    const total = emptyReport()
    total.received = all.length

    try {
      for (let i = 0; i < all.length; i += CHUNK) {
        const chunk = all.slice(i, i + CHUNK)
        setProgress(`Adding ${Math.min(i + chunk.length, all.length).toLocaleString()} of ${all.length.toLocaleString()}…`)

        const res = await fetch(`/api/campaigns/${campaignId}/leads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The offset is what makes an error say "row 1,412" rather than
          // "row 412 of the third chunk", which is not a thing anyone can find.
          body: JSON.stringify({ rows: chunk, offset: i }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error ?? "Something went wrong. Please try again.")
          return
        }

        total.added += body.added ?? 0
        total.duplicate += body.duplicate ?? 0
        total.duplicateInFile += body.duplicateInFile ?? 0
        total.suppressed += body.suppressed ?? 0
        total.invalid.push(...(body.invalid ?? []))
      }

      setReport(total)
      setHeaders([]); setRows([]); setMap(null)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function pullFromCrm() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crmTag }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setReport(body)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const preview = rows.slice(0, 3)
  const columnOptions = [
    { value: "", label: "— none —" },
    ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
  ]
  const setCol = (k: keyof ColumnGuess) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setMap(m => (m ? { ...m, [k]: e.target.value === "" ? null : Number(e.target.value) } : m))

  return (
    <>
      {compact ? (
        <SecondaryButton type="button" onClick={() => setOpen(true)}>Add people</SecondaryButton>
      ) : (
        <div>
          <p className="text-[13px] font-light text-muted">
            Upload a spreadsheet, or pull everyone carrying a tag out of your CRM. Numbers on
            your do-not-call list are dropped, and the same person listed twice is added once.
          </p>
          <div className="mt-4">
            <SubmitButton type="button" sheen={false} className="w-auto px-5"
                          onClick={() => setOpen(true)}>
              Add people
            </SubmitButton>
          </div>
        </div>
      )}

      <Panel
        open={open}
        title="Add people to call"
        subtitle="Nothing is dialled until you start the campaign."
        onClose={() => { setOpen(false); reset() }}
        footer={
          headers.length > 0 ? (
            <div className="flex justify-end gap-2">
              <SecondaryButton type="button" onClick={reset} disabled={busy}>Choose another file</SecondaryButton>
              <SubmitButton type="button" sheen={false} className="w-auto px-5"
                            loading={busy} onClick={upload}>
                Add {rows.length.toLocaleString()}
              </SubmitButton>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-5">
          {error && <ErrorNote>{error}</ErrorNote>}
          {progress && <InfoNote>{progress}</InfoNote>}

          {report && (
            <div className="rounded-2xl border border-line bg-field-soft px-4 py-3.5">
              <p className="text-[13px] font-medium">
                {report.added.toLocaleString()} added
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[12.5px] font-light text-muted">
                {report.duplicate > 0 && (
                  <li>{report.duplicate.toLocaleString()} were already in this campaign</li>
                )}
                {report.duplicateInFile > 0 && (
                  <li>{report.duplicateInFile.toLocaleString()} appeared more than once in the file</li>
                )}
                {report.suppressed > 0 && (
                  <li>{report.suppressed.toLocaleString()} are on your do-not-call list</li>
                )}
                {report.invalid.length > 0 && (
                  <li>{report.invalid.length.toLocaleString()} weren&rsquo;t usable phone numbers</li>
                )}
              </ul>

              {report.invalid.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[12.5px] text-muted hover:text-fg">
                    Show the ones we couldn&rsquo;t use
                  </summary>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[12px] font-light text-subtle">
                    {report.invalid.slice(0, 100).map((b, i) => (
                      <li key={i}>
                        Row {b.row}: {b.value ? `"${b.value}"` : "(empty)"} — {b.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {headers.length === 0 && !report && (
            <>
              <div className="flex gap-2">
                <SecondaryButton
                  type="button"
                  onClick={() => setMode("file")}
                  className={cn(mode === "file" && "border-brand-500/60 bg-brand-500/12 text-brand-on-tint")}
                >
                  From a spreadsheet
                </SecondaryButton>
                <SecondaryButton
                  type="button"
                  onClick={() => setMode("crm")}
                  className={cn(mode === "crm" && "border-brand-500/60 bg-brand-500/12 text-brand-on-tint")}
                >
                  From your CRM
                </SecondaryButton>
              </div>

              {mode === "file" ? (
                <div>
                  <label
                    htmlFor="lead-csv"
                    className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-field-soft px-6 py-10 text-center transition-colors hover:border-brand-400"
                  >
                    <span className="text-[13.5px] font-medium">Choose a CSV file</span>
                    <span className="text-[12.5px] font-light text-muted">
                      It&rsquo;s read here on your computer — only the rows we can use are sent.
                    </span>
                  </label>
                  <input
                    ref={fileInput}
                    id="lead-csv"
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={onFile}
                  />
                  <p className="mt-3 text-[12px] font-light text-subtle">
                    Numbers without a country code are treated as +{countryCode}. Change that in
                    Settings if your list is from somewhere else.
                  </p>
                </div>
              ) : !crmConnected ? (
                <InfoNote>
                  Your CRM isn&rsquo;t connected to this workspace yet, so there are no lists to
                  pull from. Ask us to connect it and tagged lists will appear here.
                </InfoNote>
              ) : (
                <div className="space-y-4">
                  <Field
                    label="Tag"
                    value={crmTag}
                    onChange={e => setCrmTag(e.target.value)}
                    placeholder="september-followup"
                    hint="Everyone in your CRM carrying this tag is copied in. It's a snapshot — tagging someone afterwards won't add them to a campaign that's already running."
                  />
                  <SubmitButton
                    type="button" sheen={false} className="w-auto px-5"
                    loading={busy} disabled={!crmTag.trim()}
                    onClick={pullFromCrm}
                  >
                    Pull the list
                  </SubmitButton>
                </div>
              )}
            </>
          )}

          {headers.length > 0 && (
            <div className="space-y-4">
              <div>
                <p className="text-[13px] font-medium">{fileName}</p>
                <p className="mt-0.5 text-[12.5px] font-light text-muted">
                  {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}
                  {ragged.length > 0 &&
                    ` · ${ragged.length} skipped for having the wrong number of columns`}
                </p>
              </div>

              <div className="space-y-3">
                <Select label="Phone number" options={columnOptions}
                        value={map?.phone === null || map?.phone === undefined ? "" : String(map.phone)}
                        onChange={setCol("phone")}
                        hint="The only one we actually need." />
                {map?.fullName !== null && map?.fullName !== undefined ? (
                  <Select label="Name" options={columnOptions}
                          value={String(map.fullName)} onChange={setCol("fullName")} />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Select label="First name" options={columnOptions}
                            value={map?.firstName === null || map?.firstName === undefined ? "" : String(map.firstName)}
                            onChange={setCol("firstName")} />
                    <Select label="Last name" options={columnOptions}
                            value={map?.lastName === null || map?.lastName === undefined ? "" : String(map.lastName)}
                            onChange={setCol("lastName")} />
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-left text-[12px]">
                  <thead className="border-b border-line-soft bg-field-soft">
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i} className="whitespace-nowrap px-3 py-2 font-medium text-muted">
                          {h || `Column ${i + 1}`}
                          {map?.phone === i && (
                            <span className="ml-1.5 text-brand-on-tint">phone</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, n) => (
                      <tr key={n} className="border-b border-line-soft last:border-0">
                        {r.map((v, i) => (
                          <td key={i} className="whitespace-nowrap px-3 py-2 text-subtle">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[12px] font-light text-subtle">
                Showing the first {preview.length} rows so you can check the columns line up.
              </p>
            </div>
          )}
        </div>
      </Panel>
    </>
  )
}
