"use client"

/**
 * Invite someone to the workspace.
 *
 * Two outcomes, depending on whether email is configured upstream: either "we
 * sent them a link", or a one-time password to hand over yourself. The second
 * is explicitly framed as shown-once, because it is.
 */

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Field, SubmitButton, ErrorNote, InfoNote } from "@/components/ui/field"
import { Panel, SecondaryButton, DangerButton } from "@/components/ui/form"

type Result =
  | { mode: "email"; email: string }
  | { mode: "password"; email: string; password: string }

export function InviteMember() {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)

  const valid = name.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  function close() {
    setOpen(false)
    setResult(null)
    setError(null)
    setCopied(false)
    setName("")
    setEmail("")
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), type: "ACCOUNT_MANAGER" }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setResult(body as Result)
      startTransition(() => router.refresh())
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="border-t border-line px-5 py-4">
        <SecondaryButton onClick={() => setOpen(true)}>Invite someone</SecondaryButton>
      </div>

      <Panel
        open={open}
        onClose={close}
        title="Invite someone"
        subtitle="They'll be able to build agents, review calls and see billing."
      >
        {result ? (
          <div className="space-y-4">
            {result.mode === "email" ? (
              <InfoNote>
                Invitation sent to {result.email}. The link works for seven days.
              </InfoNote>
            ) : (
              <>
                <InfoNote>
                  {result.email} can sign in straight away. Email isn&rsquo;t set up on this
                  workspace yet, so pass this password to them yourself.
                </InfoNote>

                <div className="space-y-2">
                  <span className="block text-xs font-medium text-muted">
                    Temporary password — shown once
                  </span>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-field border border-line bg-field px-3 py-2.5 font-mono text-[13px] text-fg">
                      {result.password}
                    </code>
                    <SecondaryButton
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(result.password)
                        setCopied(true)
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </SecondaryButton>
                  </div>
                  <p className="text-xs leading-relaxed text-subtle">
                    Once you close this panel it can&rsquo;t be shown again. They can change
                    it from Settings after signing in.
                  </p>
                </div>
              </>
            )}

            <SecondaryButton type="button" onClick={close}>
              Done
            </SecondaryButton>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <ErrorNote>{error}</ErrorNote>}

            <Field
              label="Their name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Priya Sharma"
              minLength={2}
              required
            />
            <Field
              label="Their email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="priya@example.com"
              required
              hint="They'll get their own sign-in — you never share yours."
            />

            <SubmitButton type="submit" loading={busy} disabled={!valid} sheen={false}>
              Send invitation
            </SubmitButton>
          </form>
        )}
      </Panel>
    </>
  )
}

/* ── Row actions on a pending invitation ───────────────────────────────── */

export function InviteActions({ id, canResend }: { id: string; canResend: boolean }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function call(method: "POST" | "DELETE") {
    setBusy(true)
    try {
      const res = await fetch(`/api/team/invitations/${id}`, { method })
      if (res.ok) startTransition(() => router.refresh())
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-2">
        <SecondaryButton onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </SecondaryButton>
        <DangerButton onClick={() => call("DELETE")} disabled={busy}>
          Revoke
        </DangerButton>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canResend && (
        <SecondaryButton onClick={() => call("POST")} disabled={busy} className="h-8 px-3 text-[12px]">
          Resend
        </SecondaryButton>
      )}
      <SecondaryButton onClick={() => setConfirming(true)} disabled={busy} className="h-8 px-3 text-[12px]">
        Revoke
      </SecondaryButton>
    </div>
  )
}
