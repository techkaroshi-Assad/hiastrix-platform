"use client"

/**
 * The campaigns page header: a link to the new-campaign page, and the
 * do-not-call list.
 *
 * Creating a campaign used to live here in a `<Panel>` and has moved to its own
 * page — a 520px slide-over is the right shape for one job with one control,
 * and the wrong one for nine settings. The suppression list is still a Panel,
 * because it genuinely is one job with one control.
 *
 * Nothing in this file is imported by a server component. `campaignTone` and
 * the labels used to be exported from here, which compiled cleanly and then
 * threw at runtime — see tones.ts.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Panel, SecondaryButton, TextArea } from "@/components/ui/form"

export type SuppressionRow = {
  id: string
  phoneE164: string
  source: string
  note: string | null
  addedAt: string
}

export function CampaignsHeader({
  suppressions,
  canCreate,
  lockedReason,
}: {
  suppressions: SuppressionRow[]
  canCreate: boolean
  lockedReason: string | null
}) {
  const [dnc, setDnc] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <SecondaryButton type="button" onClick={() => setDnc(true)}>
        Do not call
        {suppressions.length > 0 && (
          <span className="ml-1.5 tabular-nums text-subtle">{suppressions.length}</span>
        )}
      </SecondaryButton>

      {canCreate ? (
        <Link
          href="/dashboard/campaigns/new"
          className="inline-flex items-center justify-center rounded-field bg-linear-to-b from-brand-400 to-brand-600 px-5 py-2.5 text-[13px] font-medium text-on-brand transition-opacity hover:opacity-90"
        >
          New campaign
        </Link>
      ) : (
        <span
          title={lockedReason ?? undefined}
          className="inline-flex cursor-not-allowed items-center justify-center rounded-field bg-linear-to-b from-brand-400 to-brand-600 px-5 py-2.5 text-[13px] font-medium text-on-brand opacity-50"
        >
          New campaign
        </span>
      )}

      <DoNotCall open={dnc} rows={suppressions} onClose={() => setDnc(false)} />
    </div>
  )
}

/* ── Do not call ───────────────────────────────────────────────────────── */

const SOURCE_LABEL: Record<string, string> = {
  UPLOAD: "Added by you",
  MANUAL: "Added by you",
  CALLER_REQUEST: "Asked not to be called",
}

function DoNotCall({
  open,
  rows,
  onClose,
}: {
  open: boolean
  rows: SuppressionRow[]
  onClose: () => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [numbers, setNumbers] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setDone(null); setBusy(true)
    try {
      const res = await fetch("/api/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      const parts = [`${body.added} added`]
      if (body.alreadyListed) parts.push(`${body.alreadyListed} already there`)
      if (body.removedFromCampaigns) parts.push(`${body.removedFromCampaigns} removed from campaigns`)
      if (body.invalid?.length) parts.push(`${body.invalid.length} not recognised`)
      setDone(parts.join(" · "))
      setNumbers("")
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      const res = await fetch("/api/suppressions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    }
  }

  return (
    <Panel
      open={open}
      title="Do not call"
      subtitle="Numbers here are never dialled by any of your campaigns, and are dropped from any list you upload."
      onClose={onClose}
    >
      <form onSubmit={add} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        {done && <InfoNote>{done}</InfoNote>}

        <TextArea
          label="Add numbers"
          rows={4}
          value={numbers}
          onChange={e => setNumbers(e.target.value)}
          placeholder={"+1 313 555 0100\n+1 313 555 0101"}
          hint="One per line, or separated by commas. They're also pulled out of anything already queued."
        />
        <SubmitButton
          type="submit" sheen={false} className="w-auto px-5"
          loading={busy} disabled={!numbers.trim()}
        >
          Add
        </SubmitButton>
      </form>

      <div className="mt-6 border-t border-line pt-5">
        {rows.length === 0 ? (
          <p className="text-[13px] font-light text-muted">Nothing on the list yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map(s => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="tabular-nums text-[13px]">{s.phoneE164}</p>
                  <p className="text-[11.5px] font-light text-subtle">
                    {SOURCE_LABEL[s.source] ?? s.source}
                    {s.note ? ` · ${s.note}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="shrink-0 text-[12px] text-muted transition-colors hover:text-danger"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows.length >= 200 && (
          <p className="mt-3 text-[11.5px] font-light text-subtle">
            Showing the 200 most recent.
          </p>
        )}
      </div>
    </Panel>
  )
}
