"use client"

/**
 * The dialer's platform-wide limits.
 *
 * Every one of these is enforced in SQL by the claim (lib/dialer/claim.ts)
 * or at dial time (lib/dialer/dial.ts), so a value saved here changes
 * behaviour on the next tick, not the next deploy.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Toggle, TextArea } from "@/components/ui/form"

export type DialerSettings = {
  dialerEnabled: boolean
  maxConcurrentCalls: number
  tenantMaxConcurrent: number
  numberDailyCallCap: number
  contactDailyCap: number
  consentLine: string
}

export function DialerSettingsForm({ initial, canEdit }: { initial: DialerSettings; canEdit: boolean }) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [enabled, setEnabled]   = useState(initial.dialerEnabled)
  const [platform, setPlatform] = useState(String(initial.maxConcurrentCalls))
  const [tenant, setTenant]     = useState(String(initial.tenantMaxConcurrent))
  const [perNumber, setPerNumber] = useState(String(initial.numberDailyCallCap))
  const [perContact, setPerContact] = useState(String(initial.contactDailyCap))
  const [consent, setConsent]   = useState(initial.consentLine)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState(false)

  const dirty =
    enabled !== initial.dialerEnabled ||
    Number(platform) !== initial.maxConcurrentCalls ||
    Number(tenant) !== initial.tenantMaxConcurrent ||
    Number(perNumber) !== initial.numberDailyCallCap ||
    Number(perContact) !== initial.contactDailyCap ||
    consent.trim() !== initial.consentLine

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)
    setBusy(true)
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dialerEnabled:       enabled,
          maxConcurrentCalls:  Math.round(Number(platform)),
          tenantMaxConcurrent: Math.round(Number(tenant)),
          numberDailyCallCap:  Math.round(Number(perNumber)),
          contactDailyCap:     Math.round(Number(perContact)),
          consentLine:         consent.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setDone(true)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 px-5 py-5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {done && <InfoNote>Dialer settings saved. They apply from the next dialer tick.</InfoNote>}

      <Toggle
        label="Outbound calling"
        description="Off pauses every campaign on the platform at once. Lists are untouched and carry on where they stopped when it's turned back on."
        checked={enabled}
        onChange={setEnabled}
        disabled={!canEdit || busy}
      />

      <Field
        label="Calls per number per day"
        type="number" min={1} max={5000}
        value={perNumber}
        onChange={e => setPerNumber(e.target.value)}
        disabled={!canEdit || busy}
        hint="Rolling 24 hours, counting calls the carrier actually saw. Carriers start flagging a caller ID as spam when one number dials all day — 200 is conservative; a campaign wanting more should rotate across more numbers rather than push one harder. When every number attached to an agent is at this cap, its campaigns wait and resume on their own as calls age out."
      />

      <Field
        label="Calls per contact per day"
        type="number" min={1} max={20}
        value={perContact}
        onChange={e => setPerContact(e.target.value)}
        disabled={!canEdit || busy}
        hint="How many times one phone number can be dialled in 24 hours across all campaigns and tenants. This is a nuisance-call guard; keep it low."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Platform concurrent calls"
          type="number" min={1} max={500}
          value={platform}
          onChange={e => setPlatform(e.target.value)}
          disabled={!canEdit || busy}
          hint="Across every tenant. Keep this at or below the concurrency the voice provider account allows, or calls fail at placement."
        />
        <Field
          label="Default per-tenant concurrent calls"
          type="number" min={1} max={200}
          value={tenant}
          onChange={e => setTenant(e.target.value)}
          disabled={!canEdit || busy}
          hint="A tenant's own setting can lower this, never raise it above the platform ceiling."
        />
      </div>

      <TextArea
        label="Consent line for campaign calls"
        rows={2}
        value={consent}
        onChange={e => setConsent(e.target.value)}
        maxLength={500}
        disabled={!canEdit || busy}
        hint="Added to every campaign agent's instructions at dial time. Tenants can't edit or remove it."
      />

      {canEdit ? (
        <SubmitButton type="submit" loading={busy} disabled={!dirty} sheen={false} className="w-auto px-5">
          Save dialer settings
        </SubmitButton>
      ) : (
        <p className="text-xs text-subtle">Only a super admin can change these.</p>
      )}
    </form>
  )
}
