"use client"

/**
 * Operator controls for a single tenant: status, package, manual credit.
 * Every credit change requires a reason, which is written to the ledger.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Select } from "@/components/ui/form"
import { usd } from "@/lib/format"

type Pkg = { id: string; name: string; minutesIncluded: number }

export function TenantControls({
  tenantId,
  status,
  packageId,
  packages,
  balanceCents,
}: {
  tenantId: string
  status: string
  packageId: string | null
  packages: Pkg[]
  balanceCents: number
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const [nextStatus, setNextStatus] = useState(status)
  const [nextPackage, setNextPackage] = useState(packageId ?? "")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")

  async function send(payload: Record<string, unknown>, message: string) {
    setError(null)
    setDone(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return false
      }
      setDone(message)
      startTransition(() => router.refresh())
      return true
    } catch {
      setError("Something went wrong. Please try again.")
      return false
    } finally {
      setBusy(false)
    }
  }

  const cents = Math.round(Number(amount) * 100)
  const creditValid = Number.isFinite(cents) && cents !== 0 && reason.trim().length >= 2

  return (
    <div className="space-y-6 px-5 py-5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {done && <InfoNote>{done}</InfoNote>}

      {/* Status + package */}
      <div className="space-y-4">
        <Select
          label="Status"
          value={nextStatus}
          onChange={e => setNextStatus(e.target.value)}
          options={[
            { value: "PENDING",  label: "Pending" },
            { value: "ACTIVE",   label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
            { value: "BLOCKED",  label: "Blocked" },
          ]}
          hint="Blocking or deactivating a tenant pauses all of its agents immediately."
        />

        <Select
          label="Package"
          value={nextPackage}
          onChange={e => setNextPackage(e.target.value)}
          placeholder="No package"
          options={packages.map(p => ({
            value: p.id,
            label: p.name,
            note: `${p.minutesIncluded.toLocaleString()} min`,
          }))}
        />

        <SubmitButton
          type="button"
          loading={busy}
          disabled={nextStatus === status && nextPackage === (packageId ?? "")}
          sheen={false}
          className="w-auto px-5"
          onClick={() =>
            send(
              {
                status: nextStatus,
                packageId: nextPackage === "" ? null : nextPackage,
              },
              "Tenant updated."
            )
          }
        >
          Apply changes
        </SubmitButton>
      </div>

      {/* Manual credit */}
      <div className="space-y-4 border-t border-white/[0.06] pt-6">
        <div>
          <h3 className="text-[13.5px] font-semibold">Adjust credit</h3>
          <p className="mt-1 text-xs text-subtle">
            Current balance {usd(balanceCents)}. Use a negative amount to deduct.
            Every adjustment is written to the tenant&rsquo;s credit history with
            your reason and email.
          </p>
        </div>

        <Field
          label="Amount (USD)"
          type="number"
          step="1"
          inputMode="decimal"
          placeholder="50 or -25"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />

        <Field
          label="Reason"
          placeholder="Goodwill credit for outage"
          value={reason}
          onChange={e => setReason(e.target.value)}
          minLength={2}
          maxLength={300}
        />

        <SubmitButton
          type="button"
          loading={busy}
          disabled={!creditValid}
          sheen={false}
          className="w-auto px-5"
          onClick={async () => {
            const ok = await send(
              { credit: { amountCents: cents, reason: reason.trim() } },
              `Balance adjusted by ${cents > 0 ? "+" : "−"}${usd(Math.abs(cents))}.`
            )
            if (ok) {
              setAmount("")
              setReason("")
            }
          }}
        >
          Apply adjustment
        </SubmitButton>
      </div>
    </div>
  )
}
