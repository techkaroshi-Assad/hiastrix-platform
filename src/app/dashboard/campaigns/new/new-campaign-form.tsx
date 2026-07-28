"use client"

/**
 * Creating a campaign.
 *
 * Laid out as four titled sections in a readable column rather than a stack of
 * inputs, because the settings here are not equally interesting: two of them
 * decide who gets called, and the rest decide how politely. Grouping them that
 * way lets someone accept the defaults for the second half without reading it.
 *
 * The two settings most likely to cause an unpleasant surprise — the calling
 * window's time zone, and what happens when a machine answers — carry their
 * consequence in the hint rather than in documentation nobody opens.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Select, TextArea, SecondaryButton } from "@/components/ui/form"
import { cn } from "@/lib/utils"

export type AgentOption = {
  id: string
  name: string
  active: boolean
  voicemailDetection: boolean
  numbers: { id: string; phoneNumber: string }[]
}

const DAYS = [
  { n: 1, label: "Mon" }, { n: 2, label: "Tue" }, { n: 3, label: "Wed" },
  { n: 4, label: "Thu" }, { n: 5, label: "Fri" }, { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
]

/**
 * A short list rather than every zone on earth. The calling window only means
 * anything in the *recipient's* local time, and these cover where a list
 * actually lives. `Intl.supportedValuesOf` would offer hundreds, which is a
 * worse picker rather than a more complete one.
 */
const ZONES = [
  ["America/New_York", "Eastern — New York"],
  ["America/Chicago", "Central — Chicago"],
  ["America/Denver", "Mountain — Denver"],
  ["America/Phoenix", "Arizona — Phoenix"],
  ["America/Los_Angeles", "Pacific — Los Angeles"],
  ["America/Anchorage", "Alaska — Anchorage"],
  ["Pacific/Honolulu", "Hawaii — Honolulu"],
  ["America/Toronto", "Eastern — Toronto"],
  ["America/Vancouver", "Pacific — Vancouver"],
  ["Europe/London", "UK — London"],
  ["Europe/Dublin", "Ireland — Dublin"],
  ["Europe/Paris", "Central Europe — Paris"],
  ["Europe/Berlin", "Central Europe — Berlin"],
  ["Europe/Madrid", "Central Europe — Madrid"],
  ["Asia/Dubai", "Gulf — Dubai"],
  ["Asia/Karachi", "Pakistan — Karachi"],
  ["Asia/Kolkata", "India — Kolkata"],
  ["Asia/Singapore", "Singapore"],
  ["Australia/Sydney", "Australia — Sydney"],
  ["Pacific/Auckland", "New Zealand — Auckland"],
] as const

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-line bg-field-soft">
      <header className="border-b border-line px-6 py-4">
        <h2 className="text-[14px] font-medium">{title}</h2>
        {description && (
          <p className="mt-1 text-[12.5px] font-light text-muted">{description}</p>
        )}
      </header>
      <div className="space-y-5 px-6 py-5">{children}</div>
    </section>
  )
}

export function NewCampaignForm({ agents }: { agents: AgentOption[] }) {
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

  const windowInvalid = windowStart >= windowEnd
  const needsDetection = voicemailPolicy !== "HANG_UP_DONE"
  const detectionMissing = Boolean(agent && needsDetection && !agent.voicemailDetection)

  const blocked =
    !name.trim() || !agentId || !days.length || windowInvalid ||
    (voicemailPolicy === "LEAVE_MESSAGE" && !voicemailMessage.trim())

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          agentId,
          phoneNumberId: phoneNumberId || null,
          timezone, windowStart, windowEnd, windowDays: days,
          maxConcurrent, maxAttempts,
          voicemailPolicy,
          voicemailMessage: voicemailPolicy === "LEAVE_MESSAGE" ? voicemailMessage.trim() : null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      // Straight into the campaign — it is empty, and adding people is the
      // obvious next thing to do.
      startTransition(() => router.push(`/dashboard/campaigns/${body.id}`))
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={create} className="max-w-[760px] space-y-5 pb-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Section
        title="What it's called, and who makes the calls"
        description="The name is only ever shown to you."
      >
        <Field
          label="Campaign name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="September follow-ups"
          minLength={2}
          maxLength={120}
          required
        />

        <Select
          label="Agent"
          value={agentId}
          onChange={e => { setAgentId(e.target.value); setPhoneNumberId("") }}
          options={agents.map(a => ({
            value: a.id,
            label: a.name,
            note: !a.active
              ? "switched off"
              : a.numbers.length === 0
                ? "no number attached"
                : undefined,
          }))}
        />

        {agent && !agent.active && (
          <InfoNote>
            {agent.name} is switched off. You can still set this campaign up, but it
            won&rsquo;t start until the agent is turned on.
          </InfoNote>
        )}

        {agent && agent.numbers.length === 0 ? (
          <InfoNote>
            {agent.name} has no phone number attached, so it has nothing to show as the
            caller. Attach one on the Phone numbers page before starting.
          </InfoNote>
        ) : agent && agent.numbers.length === 1 ? (
          <p className="text-[12.5px] font-light text-muted">
            Calls will show as{" "}
            <span className="tabular-nums text-fg">{agent.numbers[0].phoneNumber}</span>.
          </p>
        ) : agent ? (
          <Select
            label="Show as caller"
            value={phoneNumberId}
            onChange={e => setPhoneNumberId(e.target.value)}
            options={[
              { value: "", label: `Rotate across all ${agent.numbers.length} numbers`, note: "recommended" },
              ...agent.numbers.map(n => ({ value: n.id, label: n.phoneNumber })),
            ]}
            hint="Rotating spreads the calls out. One number making hundreds a day gets flagged as spam by carriers and stops being answered."
          />
        ) : null}
      </Section>

      <Section
        title="When it's allowed to call"
        description="These hours are in the time zone the people you're calling live in — not yours."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="From" type="time" required
            value={windowStart} onChange={e => setWindowStart(e.target.value)}
          />
          <Field
            label="Until" type="time" required
            value={windowEnd} onChange={e => setWindowEnd(e.target.value)}
          />
        </div>

        {windowInvalid && (
          <p className="text-[11.5px] text-danger">
            The window has to end after it starts.
          </p>
        )}

        <Select
          label="Their time zone"
          value={timezone}
          onChange={e => setTimezone(e.target.value)}
          options={ZONES.map(([value, label]) => ({ value, label }))}
        />

        <div>
          <span className="text-[13px] font-medium text-muted">Days</span>
          <div className="mt-2.5 flex flex-wrap gap-2">
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
                    "min-w-[62px] rounded-field border px-3.5 py-2 text-[12.5px] transition-colors",
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

        <p className="text-[12px] font-light text-subtle">
          Anyone who comes due outside these hours waits for the next opening. Nobody is
          skipped.
        </p>
      </Section>

      <Section
        title="How hard it tries"
        description="Sensible defaults — you can change these later without stopping the campaign."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Calls at once"
            type="number" min={1} max={100} required
            value={maxConcurrent}
            onChange={e => setMaxConcurrent(Number(e.target.value))}
            hint="How many people it talks to simultaneously."
          />
          <Field
            label="Attempts per person"
            type="number" min={1} max={10} required
            value={maxAttempts}
            onChange={e => setMaxAttempts(Number(e.target.value))}
            hint="Before it gives up on them."
          />
        </div>
        <p className="text-[12px] font-light text-subtle">
          A busy line is retried sooner than an unanswered one, and nobody is called more
          than twice a day however many campaigns they appear in.
        </p>
      </Section>

      <Section title="When an answering machine picks up">
        <Select
          label="Do this"
          value={voicemailPolicy}
          onChange={e => setVoicemailPolicy(e.target.value)}
          options={[
            { value: "HANG_UP_RETRY", label: "Hang up and try again later" },
            { value: "LEAVE_MESSAGE", label: "Leave a message and move on" },
            { value: "HANG_UP_DONE",  label: "Hang up and don't try again" },
          ]}
        />

        {voicemailPolicy === "LEAVE_MESSAGE" && (
          <TextArea
            label="What to say"
            rows={3}
            value={voicemailMessage}
            onChange={e => setVoicemailMessage(e.target.value)}
            maxLength={1000}
            placeholder="Hi, this is Sarah from Astrix — I was calling about your enquiry. I'll try again tomorrow."
          />
        )}

        {detectionMissing && (
          <InfoNote>
            {agent?.name} doesn&rsquo;t have voicemail detection switched on, so it can&rsquo;t
            tell a machine from a person — it will talk to the answerphone and record it as
            a real conversation. Turn it on for this agent, or choose &ldquo;hang up and
            don&rsquo;t try again&rdquo;.
          </InfoNote>
        )}
      </Section>

      <div className="flex items-center justify-end gap-3 pt-1">
        <Link
          href="/dashboard/campaigns"
          className="rounded-field border border-line bg-field px-4 py-2.5 text-[13px] text-muted transition-colors hover:border-line-strong"
        >
          Cancel
        </Link>
        <SecondaryButton type="button" onClick={() => router.back()} className="hidden">
          Back
        </SecondaryButton>
        <SubmitButton
          type="submit"
          sheen={false}
          className="w-auto px-6"
          loading={busy}
          disabled={blocked}
        >
          Create campaign
        </SubmitButton>
      </div>
    </form>
  )
}
