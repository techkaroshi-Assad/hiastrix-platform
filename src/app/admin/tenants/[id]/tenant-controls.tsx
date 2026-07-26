"use client"

/**
 * Operator controls for a single tenant: status, package, manual credit, and
 * which CRM sub-account their agents act on.
 *
 * Every credit change requires a reason, which is written to the ledger.
 */

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Select, Toggle } from "@/components/ui/form"
import { usd } from "@/lib/format"

type Pkg = { id: string; name: string; minutesIncluded: number }

const CUSTOM = "__custom__"

/**
 * Tenant-facing wording for a manual adjustment. Deliberately warm and
 * branded — the client should read these as a gesture from Hi-Astrix, not as
 * an internal bookkeeping entry.
 */
const LABEL_PRESETS = [
  "Free credit from the Hi-Astrix team",
  "Trial credit — no charge",
  "Promotional discount applied by Hi-Astrix",
  "Goodwill credit from the Hi-Astrix team",
  "Balance correction by the Hi-Astrix team",
  CUSTOM,
]

type SubAccount = {
  id: string
  name: string
  takenBy: { id: string; name: string } | null
}

type CrmState = {
  connected: boolean
  problem?: "unconfigured" | "disconnected" | "unavailable"
  detail?: string
  locations: SubAccount[]
}

/** Three different problems, three different next actions. Collapsing them into
 *  one message sends operators to the wrong screen. */
const CRM_PROBLEM: Record<string, string> = {
  unconfigured: "The CRM keys aren't set on this environment yet.",
  disconnected: "No CRM is connected yet.",
  unavailable:  "The CRM isn't responding right now.",
}

export function TenantControls({
  tenantId,
  status,
  packageId,
  packages,
  balanceCents,
  crmLocationId,
}: {
  tenantId: string
  status: string
  packageId: string | null
  packages: Pkg[]
  balanceCents: number
  crmLocationId: string | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const [nextStatus, setNextStatus] = useState(status)
  const [nextPackage, setNextPackage] = useState(packageId ?? "")
  const [amount, setAmount] = useState("")
  const [preset, setPreset] = useState(LABEL_PRESETS[0])
  const [label, setLabel] = useState(LABEL_PRESETS[0])
  const [activate, setActivate] = useState(false)

  const [nextLocation, setNextLocation] = useState(crmLocationId ?? "")
  const [crm, setCrm] = useState<CrmState | null>(null)

  useEffect(() => {
    let live = true
    fetch("/api/admin/crm/locations")
      .then(r => (r.ok ? r.json() : { connected: false, problem: "unavailable", locations: [] }))
      .then(data => { if (live) setCrm(data) })
      .catch(() => { if (live) setCrm({ connected: false, problem: "unavailable", locations: [] }) })
    return () => { live = false }
  }, [])

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
  const creditValid =
    amount.trim() !== "" &&
    Number.isFinite(cents) &&
    cents !== 0 &&
    label.trim().length >= 2

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

      {/* CRM sub-account */}
      <div className="space-y-4 border-t border-line pt-6">
        <div>
          <h4 className="text-[13px] font-semibold">CRM sub-account</h4>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            Which sub-account this tenant&rsquo;s agents read and write. Until one is
            chosen, their agents decline every CRM action rather than guessing.
          </p>
        </div>

        {crm && !crm.connected ? (
          <div className="space-y-1">
            <p className="text-xs text-muted">
              {CRM_PROBLEM[crm.problem ?? "unavailable"]}{" "}
              <a href="/admin/settings" className="underline-offset-4 hover:text-fg hover:underline">
                Check Settings
              </a>
              .
            </p>
            {crm.detail && <p className="text-xs text-subtle">{crm.detail}</p>}
          </div>
        ) : (
          <>
            <Select
              label="Sub-account"
              value={nextLocation}
              onChange={e => setNextLocation(e.target.value)}
              placeholder={crm ? "Not linked" : "Loading…"}
              disabled={!crm}
              options={(crm?.locations ?? [])
                .filter(l => !l.takenBy || l.id === crmLocationId)
                .map(l => ({ value: l.id, label: l.name }))}
              hint="Sub-accounts already assigned to another tenant are not listed."
            />

            <SubmitButton
              type="button"
              loading={busy}
              disabled={nextLocation === (crmLocationId ?? "")}
              sheen={false}
              className="w-auto px-5"
              onClick={() =>
                send(
                  { crmLocationId: nextLocation || null },
                  nextLocation ? "CRM sub-account linked." : "CRM sub-account unlinked."
                )
              }
            >
              {nextLocation ? "Link sub-account" : "Unlink"}
            </SubmitButton>
          </>
        )}
      </div>

      {/* Manual credit */}
      <div className="space-y-4 border-t border-line pt-6">
        <div>
          <h3 className="text-[13.5px] font-semibold">Grant or adjust credit</h3>
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            Current balance {usd(balanceCents)}. Credit granted here lands in the
            tenant&rsquo;s balance immediately — no card, no Stripe. Use a negative
            amount to deduct.
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

        <Select
          label="How this appears to the tenant"
          value={preset}
          onChange={e => {
            setPreset(e.target.value)
            if (e.target.value !== CUSTOM) setLabel(e.target.value)
          }}
          options={LABEL_PRESETS.map(l => ({ value: l, label: l }))}
          hint="This exact wording shows in their billing history. Your email is recorded for audit but never shown to them."
        />

        {preset === CUSTOM && (
          <Field
            label="Custom wording"
            placeholder="Launch promotion — 3 months free"
            value={label}
            onChange={e => setLabel(e.target.value)}
            minLength={2}
            maxLength={160}
          />
        )}

        {status !== "ACTIVE" && cents > 0 && (
          <Toggle
            label="Activate this workspace too"
            description="Lets them create agents straight away, without waiting on a package purchase."
            checked={activate}
            onChange={setActivate}
          />
        )}

        <SubmitButton
          type="button"
          loading={busy}
          disabled={!creditValid}
          sheen={false}
          className="w-auto px-5"
          onClick={async () => {
            const ok = await send(
              {
                credit: { amountCents: cents, label: label.trim() },
                ...(activate && status !== "ACTIVE" ? { status: "ACTIVE" } : {}),
              },
              `${cents > 0 ? "Granted" : "Deducted"} ${usd(Math.abs(cents))}${
                activate && status !== "ACTIVE" ? " and activated the workspace." : "."
              }`
            )
            if (ok) {
              setAmount("")
              setActivate(false)
            }
          }}
        >
          {cents > 0 ? "Grant credit" : "Apply adjustment"}
        </SubmitButton>
      </div>
    </div>
  )
}
