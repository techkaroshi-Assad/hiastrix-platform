"use client"

/**
 * Test an agent, two ways.
 *
 * Outbound — you give a number, our server asks Vapi to ring it. Nothing
 * provider-shaped touches the browser at all.
 *
 * In-browser — the Vapi Web SDK runs in the page and needs a public key, which
 * we fetch from our own endpoint only after checking the session owns this
 * agent. The SDK is imported dynamically so it never enters the main bundle
 * and never runs during SSR.
 *
 * Both bill exactly like a real call, which the UI says plainly before you start.
 */

import { useState, useRef, useEffect } from "react"
import { SubmitButton, ErrorNote, InfoNote, Field } from "@/components/ui/field"
import { SecondaryButton, Panel } from "@/components/ui/form"
import { cn } from "@/lib/utils"

type Mode = "phone" | "browser"

type VapiLike = {
  start: (assistantId: string) => Promise<unknown>
  stop: () => void
  on: (event: string, cb: (...args: unknown[]) => void) => void
  removeAllListeners?: () => void
}

export function TestCallPanel({
  open,
  onClose,
  agentId,
  agentName,
  browserCallEnabled,
}: {
  open: boolean
  onClose: () => void
  agentId: string
  agentName: string
  browserCallEnabled: boolean
}) {
  const [mode, setMode] = useState<Mode>("phone")
  const [number, setNumber] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const [liveState, setLiveState] = useState<"idle" | "connecting" | "live">("idle")
  const [transcript, setTranscript] = useState<string[]>([])
  const vapiRef = useRef<VapiLike | null>(null)

  // Never leave a call running because the panel closed.
  useEffect(() => {
    if (!open) endBrowserCall()
    return () => endBrowserCall()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function reset() {
    setError(null)
    setNote(null)
  }

  /* ── Outbound ────────────────────────────────────────────────────── */

  async function placeOutbound() {
    reset()
    setBusy(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/test-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: number.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        return
      }
      setNote(body.message ?? "Calling you now.")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  /* ── In-browser ──────────────────────────────────────────────────── */

  async function startBrowserCall() {
    reset()
    setTranscript([])
    setLiveState("connecting")
    try {
      const res = await fetch(`/api/agents/${agentId}/web-call`, { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.")
        setLiveState("idle")
        return
      }

      // Dynamic import: keeps the SDK out of the main bundle and off the server.
      const mod = await import("@vapi-ai/web")
      const Vapi = (mod.default ?? mod) as new (key: string) => VapiLike
      const vapi = new Vapi(body.publicKey)
      vapiRef.current = vapi

      vapi.on("call-start", () => setLiveState("live"))
      vapi.on("call-end", () => {
        setLiveState("idle")
        setNote("Call ended. It will appear in your call log once processed.")
      })
      vapi.on("error", () => {
        setError("The call dropped. Please try again.")
        setLiveState("idle")
      })
      vapi.on("message", (...args: unknown[]) => {
        const msg = args[0] as { type?: string; role?: string; transcript?: string; transcriptType?: string }
        if (msg?.type === "transcript" && msg.transcriptType === "final" && msg.transcript) {
          setTranscript(t => [...t.slice(-40), `${msg.role === "user" ? "You" : agentName}: ${msg.transcript}`])
        }
      })

      await vapi.start(body.assistantId)
    } catch {
      setError("Couldn't start the call. Check that your browser allows microphone access.")
      setLiveState("idle")
    }
  }

  function endBrowserCall() {
    try {
      vapiRef.current?.stop()
      vapiRef.current?.removeAllListeners?.()
    } catch {
      /* already stopped */
    }
    vapiRef.current = null
    setLiveState("idle")
  }

  const validNumber = /^\+[1-9]\d{7,14}$/.test(number.trim())

  return (
    <Panel
      open={open}
      onClose={onClose}
      title={`Test ${agentName}`}
      subtitle="Test calls use the same minutes and billing as real calls."
    >
      <div className="space-y-5">
        {error && <ErrorNote>{error}</ErrorNote>}
        {note && <InfoNote>{note}</InfoNote>}

        {/* Mode switch */}
        <div className="flex gap-2">
          <SecondaryButton
            type="button"
            onClick={() => { setMode("phone"); reset() }}
            className={cn(mode === "phone" && "border-brand-500/60 bg-brand-500/12 text-brand-200")}
          >
            Call my phone
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={() => { setMode("browser"); reset() }}
            className={cn(mode === "browser" && "border-brand-500/60 bg-brand-500/12 text-brand-200")}
          >
            Talk in browser
          </SecondaryButton>
        </div>

        {mode === "phone" ? (
          <div className="space-y-4">
            <Field
              label="Your phone number"
              value={number}
              onChange={e => setNumber(e.target.value)}
              placeholder="+14155550123"
              inputMode="tel"
              hint="International format, starting with +. The agent will ring this number from one of your allocated numbers."
            />
            <SubmitButton
              type="button"
              onClick={placeOutbound}
              loading={busy}
              disabled={!validNumber}
              sheen={false}
            >
              Call me now
            </SubmitButton>
          </div>
        ) : !browserCallEnabled ? (
          /* Say why rather than hiding the option — a missing tab reads as a
             broken product, whereas a stated reason reads as a setting. */
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Talking to your agent directly in the browser isn&rsquo;t switched on for
              this workspace yet.
            </p>
            <p className="text-[13px] leading-relaxed text-subtle">
              You can still test the agent right now by having it call your phone —
              switch to “Call my phone” above.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-muted">
              Speak to the agent through your microphone. Your browser will ask for
              permission the first time.
            </p>

            {liveState === "idle" ? (
              <SubmitButton type="button" onClick={startBrowserCall} sheen={false}>
                Start call
              </SubmitButton>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 rounded-field border border-brand-500/25 bg-brand-500/10 px-3.5 py-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 rounded-full",
                      liveState === "live" ? "bg-success animate-pulse-dot" : "bg-warning"
                    )}
                  />
                  <span className="text-[13px] text-brand-200">
                    {liveState === "live" ? "Connected — start talking" : "Connecting…"}
                  </span>
                </div>
                <SecondaryButton type="button" onClick={endBrowserCall}>
                  End call
                </SecondaryButton>
              </div>
            )}

            {transcript.length > 0 && (
              <div className="max-h-[280px] space-y-1.5 overflow-y-auto rounded-field border border-white/[0.08] bg-white/[0.02] p-3.5">
                {transcript.map((line, i) => (
                  <p key={i} className="text-[12.5px] leading-relaxed text-muted">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}
