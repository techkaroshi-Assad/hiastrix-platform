"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote } from "@/components/ui/field"
import { Panel, SecondaryButton, Toggle } from "@/components/ui/form"

export type PackageRow = {
  id: string
  name: string
  minutesIncluded: number
  priceCents: number
  /** Null until somebody subscribes — that is when the provider's copy of this
   *  plan is created. Shown so an operator can tell a plan nobody has ever
   *  bought from one that is quietly broken. */
  stripePriceId: string | null
  overageRateCents: number
  isActive: boolean
  tenants: number
}

type Draft = {
  name: string
  minutes: string
  price: string
  overage: string
  isActive: boolean
}

const BLANK: Draft = { name: "", minutes: "500", price: "0", overage: "0.35", isActive: true }

export function PackagesClient({ packages }: { packages: PackageRow[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PackageRow | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openCreate() {
    setEditing(null)
    setDraft(BLANK)
    setError(null)
    setOpen(true)
  }

  function openEdit(p: PackageRow) {
    setEditing(p)
    setDraft({
      name:     p.name,
      minutes:  String(p.minutesIncluded),
      price:    (p.priceCents / 100).toString(),
      overage:  (p.overageRateCents / 100).toString(),
      isActive: p.isActive,
    })
    setError(null)
    setOpen(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const payload = {
        name:             draft.name.trim(),
        minutesIncluded:  Math.round(Number(draft.minutes)),
        priceCents:       Math.round(Number(draft.price) * 100),
        overageRateCents: Math.round(Number(draft.overage) * 100),
        isActive:         draft.isActive,
      }

      const res = await fetch(
        editing ? `/api/admin/packages/${editing.id}` : "/api/admin/packages",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setOpen(false)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <SecondaryButton onClick={openCreate}>New package</SecondaryButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {packages.map(p => (
          <div
            key={p.id}
            className="rounded-2xl border border-line bg-field-soft p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{p.name}</h3>
              <span
                className={
                  p.isActive
                    ? "rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success"
                    : "rounded-full bg-field-hover px-2 py-0.5 text-[11px] font-medium text-subtle"
                }
              >
                {p.isActive ? "Published" : "Retired"}
              </span>
            </div>

            <p className="mt-3 text-[26px] font-semibold tracking-[-0.03em]">
              ${(p.priceCents / 100).toLocaleString()}
              <span className="ml-1 text-[13px] font-normal text-muted">/ month</span>
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {p.minutesIncluded.toLocaleString()} minutes included each month
            </p>
            <p className="mt-0.5 text-[12.5px] text-subtle">
              ${(p.overageRateCents / 100).toFixed(2)}/min beyond the cap
            </p>
            <p className="mt-3 text-[12px] text-subtle">
              {p.tenants} tenant{p.tenants === 1 ? "" : "s"} on this tier
              {p.stripePriceId ? "" : " · not yet live with the payment provider"}
            </p>

            <div className="mt-4">
              <SecondaryButton onClick={() => openEdit(p)}>Edit</SecondaryButton>
            </div>
          </div>
        ))}
      </div>

      <Panel
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit package" : "New package"}
        subtitle="Amounts are in USD."
        footer={
          <div className="flex items-center justify-end gap-3">
            <SecondaryButton type="button" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </SecondaryButton>
            <SubmitButton
              form="package-form"
              type="submit"
              loading={busy}
              sheen={false}
              className="w-auto px-5"
            >
              {editing ? "Save changes" : "Create package"}
            </SubmitButton>
          </div>
        }
      >
        <form id="package-form" onSubmit={save} className="space-y-5">
          {error && <ErrorNote>{error}</ErrorNote>}

          <Field
            label="Name"
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder="Growth"
            required
            minLength={2}
          />
          <Field
            label="Minutes included"
            type="number"
            min={1}
            value={draft.minutes}
            onChange={e => setDraft({ ...draft, minutes: e.target.value })}
            required
          />
          <Field
            label="Price (USD per month)"
            type="number"
            min={0}
            step="1"
            value={draft.price}
            onChange={e => setDraft({ ...draft, price: e.target.value })}
            required
            hint={
              editing
                ? "Changing this only affects new subscribers. Anyone already on this plan keeps the price they agreed to until they switch plans themselves — a price, once someone is paying it, cannot be edited underneath them."
                : "Charged monthly. The payment provider's copy of this plan is created the first time somebody subscribes."
            }
          />
          <Field
            label="Overage rate (USD per minute)"
            type="number"
            min={0}
            step="0.01"
            value={draft.overage}
            onChange={e => setDraft({ ...draft, overage: e.target.value })}
            required
            hint="Charged only for minutes beyond the included allowance, taken from the tenant's credit balance."
          />

          <Toggle
            label="Published"
            description="Retired tiers stay attached to existing subscribers and keep renewing, but nobody new can choose one."
            checked={draft.isActive}
            onChange={v => setDraft({ ...draft, isActive: v })}
          />
        </form>
      </Panel>
    </>
  )
}
