"use client"

/**
 * "Download a report" — pick two dates, get a file.
 *
 * Two formats because they answer different questions: the PDF is the
 * thing you send to a client or a manager; the Excel file is the thing you
 * sort, filter and work the callbacks from. Same numbers underneath.
 */

import { useState } from "react"
import { IconDownload } from "@/components/app/icons"

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function ReportDownload({ defaultDays = 30 }: { defaultDays?: number }) {
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - (defaultDays - 1))
  const [from, setFrom] = useState(iso(start))
  const [to, setTo] = useState(iso(today))
  const [transcripts, setTranscripts] = useState(false)

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  const qs = `from=${from}&to=${to}`

  const btn =
    "inline-flex h-9 items-center gap-2 rounded-field border px-3.5 text-[12.5px] font-medium transition-colors " +
    "disabled:pointer-events-none disabled:opacity-50"

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-field-soft px-4 py-3">
      <div>
        <label className="block text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">From</label>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
               className="mt-1 h-9 rounded-field border border-line bg-field px-2.5 text-[13px] text-fg" />
      </div>
      <div>
        <label className="block text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">To</label>
        <input type="date" value={to} min={from} max={iso(today)} onChange={e => setTo(e.target.value)}
               className="mt-1 h-9 rounded-field border border-line bg-field px-2.5 text-[13px] text-fg" />
      </div>
      <a
        href={valid ? `/api/reports/activity?${qs}` : undefined}
        aria-disabled={!valid}
        className={`${btn} border-brand-500/60 bg-brand-500/12 text-brand-on-tint hover:bg-brand-500/20 ${valid ? "" : "pointer-events-none opacity-50"}`}
      >
        <IconDownload size={14} />
        PDF report
      </a>
      <a
        href={valid ? `/api/reports/campaign?${qs}${transcripts ? "&transcripts=1" : ""}` : undefined}
        aria-disabled={!valid}
        className={`${btn} border-line bg-field text-fg hover:border-line-strong hover:bg-field-hover ${valid ? "" : "pointer-events-none opacity-50"}`}
      >
        <IconDownload size={14} />
        Excel (campaign calls)
      </a>
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input type="checkbox" checked={transcripts} onChange={e => setTranscripts(e.target.checked)} />
        include transcripts in Excel
      </label>
    </div>
  )
}
