"use client"

/**
 * Creating a campaign, and the do-not-call list.
 *
 * Both live in the page header rather than as separate routes: creating one is
 * a form, not a place, and the suppression list is something you visit twice a
 * month. A `<Panel>` for each, which is how every dialog in this app works.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Select, Panel, SecondaryButton, TextArea } from "@/components/ui/form"
import { cn } from "@/lib/utils"

export type AgentOption = {
  id: string
  name: string
  active: boolean
  numbers: { id: string; phoneNumber: string }[]
}

export type SuppressionRow = {
  id: string
  phoneE164: string
  source: string
  note: string | null
  addedAt: string
}

export function campaignTone(state: string): "neutral" | "success" | "warning" | "danger" | "brand" {
  switch (state) {
    case "RUNNING":   return "brand"
    case "COMPLETED": return "success"
    case "PAUSED":    return "warning"
    case "ARCHIVED":  return "neutral"
    default:          return "neutral"
  }
}

const DAYS = [
  { n: 1, label: "Mon" }, { n: 2, label: "Tue" }, { n: 3, label: "Wed" },
  { n: 4, label: "Thu" }, { n: 5, label: "Fri" }, { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
]

/**
 * A short list rather than every zone in the world.
 *
 * The calling window only means anything if it is the *recipient's* local time,
 * and these cover where a tenant's list actually lives. `Intl.supportedValuesOf`
 * would give hundreds, which is a worse picker, not a better one.
 */
const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu",
  "America/Toronto", "America/Vancouver",
  "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Singapore",
  "Australia/Sydney", "Pacific/Auckland",
]

export function CampaignsHeader({
  agents,
  suppressions,
  canCreate,
  lockedReason,
}: {
  agents: AgentOption[]
  suppressions: SuppressionRow[]
  canCreate: boolean
  lockedReason: string | null
}) {
  const [creating, setCreating] = useState(false)
  const [dnc, setDnc] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <SecondaryButton type="button" onClick={() => setDnc(true)}>
        Do not call
        {suppressions.length > 0 && (
          <span className="ml-1.5 tabular-nums text-subtle">{suppressions.length}</span>
        )}
      </SecondaryButton>

      <SubmitButton
        type="button"
        sheen={false}
        className="w-auto px-5"
        disabled={!canCreate}
        title={lockedReason ?? undefined}
        onClick={() => setCreating(true)}
      >
        New campaign
      </SubmitButton>

      <NewCampaign
        open={creating}
        agents={agents}
        onClose={() => setCreating(false)}
      />
      <DoNotCall
        open={dnc}
        rows={suppressions}
        onClose={() => setDnc(false)}
      />
    </div>
  )
}

/* ── New campaign ──────────────────────────────────────────────────────── */

function NewCampaign({
  open,
  agents,
  onClose,
}: {
  open: boolean
  agents: AgentOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "")
  const [phoneNumberId, setPhoneNumberId] = useState("")
  const [timezone, setTimezone] = useState("America/New_York")
  const [windowStart, setWindowStart] = useState("09:00")
  const [windowEnd, setWindowEnd] = useState("19:00")
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [maxConcurrent, setMaxConcurrent] = useState(3)
  const [maxAttempts, setMaxAttempts] = useState(3)
  const [voicemailPolicy, setVoicemailPolicy] = useState("HANG_UP_RETRY")
  const [voicemailMessage, setVoicemailMessage] = useState("")

  const agent = agents.find(a => a.id === agentId)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, agentId,
          phoneNumberId: phoneNumberId || null,
          timezone, windowStart, windowEnd, windowDays: days,
          maxConcurrent, maxAttempts,
          voicemailPolicy,
          voicemailMessage: voicemailPolicy === "LEAVE_MESSAGE" ? voicemailMessage : null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      // Straight to the campaign, because it has nobody in it yet and adding
      // people is the obvious next thing.
      startTransition(() => router.push(`/dashboard/campaigns/${body.id}`))
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      open={open}
      title="New campaign"
      subtitle="It starts empty and paused. You'll add people next, then start it when you're ready."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <SecondaryButton type="button" onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <SubmitButton
            type="submit"
            form="new-campaign"
            sheen={false}
            className="w-auto px-5"
            loading={busy}
          >
            Create
          </SubmitButton>
        </div>
      }
    >
      <form id="new-campaign" onSubmit={create} className="space-y-5">
        {error && <ErrorNote>{error}</ErrorNote>}

        <Field
          label="Name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="September follow-ups"
          minLength={2}
          maxLength={120}
          required
          hint="Only you see this."
        />

        <Select
          label="Agent"
          value={agentId}
          onChange={e => { setAgentId(e.target.value); setPhoneNumberId("") }}
          options={agents.map(a => ({
            value: a.id,
            label: a.name,
            note: !a.active ? "off" : a.numbers.length === 0 ? "no number" : undefined,
          }))}
          hint="The agent that will make the calls."
        />

        {agent && agent.numbers.length === 0 && (
          <InfoNote>
            {agent.name} has no phone number attached, so it has nothing to show as the
            caller. Attach one on the Phone numbers page before starting this campaign.
          </InfoNote>
        )}

        {agent && agent.numbers.length > 1 && (
          <Select
            label="Calling from"
            value={phoneNumberId}
            onChange={e => setPhoneNumberId(e.target.value)}
            options={[
              { value: "", label: "Rotate across all its numbers", note: "recommended" },
              ...agent.numbers.map(n => ({ value: n.id, label: n.phoneNumber })),
            ]}
            hint="Rotating spreads the calls out. One number making hundreds a day gets flagged as spam by carriers and stops being answered."
          />
        )}

        <div className="border-t border-line pt-5">
          <p className="text-[13px] font-medium">When it's allowed to call</p>
          <p className="mt-1 text-[12.5px] font-light text-muted">
            In the time zone the people you're calling live in — not yours.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field
              label="From" type="time" value={windowStart}
              onChange={e => setWindowStart(e.target.value)} required
            />
            <Field
              label="Until" type="time" value={windowEnd}
              onChange={e => setWindowEnd(e.target.value)} required
            />
          </div>

          <div className="mt-4">
            <Select
              label="Time zone"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              options={ZONES.map(z => ({ value: z, label: z.replace(/_/g, " ") }))}
            />
          </div>

          <div className="mt-4">
            <span className="text-[13px] font-medium text-muted">Days</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DAYS.map(d => {
                const on = days.includes(d.n)
                return (
                  <button
                    key={d.n}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDays(cur =>
                        cur.includes(d.n) ? cur.filter(x => x !== d.n) : [...cur, d.n].sort()
                      )
                    }
                    className={cn(
                      "rounded-field border px-3 py-1.5 text-[12.5px] transition-colors",
                      on
                        ? "border-brand-500/60 bg-brand-500/12 text-brand-on-tint"
                        : "border-line bg-field text-muted hover:border-line-strong"
                    )}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
            {days.length === 0 && (
              <p className="mt-2 text-[11.5px] text-danger">Choose at least one day.</p>
            )}
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Calls at once"
              type="number" min={1} max={100}
              value={maxConcurrent}
              onChange={e => setMaxConcurrent(Number(e.target.value))}
              hint="How many people it talks to simultaneously."
            />
            <Field
              label="Attempts per person"
              type="number" min={1} max={10}
              value={maxAttempts}
              onChange={e => setMaxAttempts(Number(e.target.value))}
              hint="Before it gives up on them."
            />
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <Select
            label="When an answering machine picks up"
            value={voicemailPolicy}
            onChange={e => setVoicemailPolicy(e.target.value)}
            options={[
              { value: "HANG_UP_RETRY", label: "Hang up and try again later" },
              { value: "LEAVE_MESSAGE", label: "Leave a message and move on" },
              { value: "HANG_UP_DONE",  label: "Hang up and don't try again" },
            ]}
            hint="The first two need voicemail detection switched on for this agent. Without it the agent talks to the machine and records it as a real conversation."
          />

          {voicemailPolicy === "LEAVE_MESSAGE" && (
            <div className="mt-4">
              <TextArea
                label="What to say"
                rows={3}
                value={voicemailMessage}
                onChange={e => setVoicemailMessage(e.target.value)}
                maxLength={1000}
                placeholder="Hi, this is Sarah from Astrix — I was calling about your enquiry. I'll try again tomorrow."
              />
            </div>
          )}
        </div>
      </form>
    </Panel>
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
        <SubmitButton type="submit" sheen={false} className="w-auto px-5" loading={busy}
                      disabled={!numbers.trim()}>
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
