import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell } from "@/components/app/app-shell"
import { Card, Pill, callTone } from "@/components/app/table"
import { CallActions } from "@/components/app/call-actions"
import { readConfig } from "@/lib/vapi/config"
import { readActions, findUnbackedClaims } from "@/lib/calls/actions"
import { usd, duration, dateTime, titleCase } from "@/lib/format"

export const metadata: Metadata = { title: "Call detail" }
export const dynamic = "force-dynamic"

/** A turn in the conversation, as the provider records it. */
type Turn = {
  role?: string
  message?: string
  time?: number
  secondsFromStart?: number
}

function turnsFrom(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return []
  return (raw as Turn[]).filter(
    t => typeof t?.message === "string" && t.message.trim() !== "" && t.role !== "system"
  )
}

function speaker(role: string | undefined, agentName: string) {
  if (role === "user") return "Caller"
  if (role === "bot" || role === "assistant") return agentName
  return titleCase(role ?? "System")
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { tenant, email } = await requireTenant()

  // Scoped by tenantId, so another tenant's call id is simply a 404.
  const call = await prisma.call.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      // The config comes along so the tool names the tenant chose can be
      // matched to the actions they actually are — `find_contact` is whatever
      // they called it, `crm.contact.find` is what it does.
      agent:       { select: { name: true, config: true } },
      phoneNumber: { select: { phoneNumber: true } },
    },
  })

  if (!call) notFound()

  const agentName = call.agent?.name ?? "Agent"
  const turns = turnsFrom(call.messages)

  /*
   * What the agent did, beside what it said.
   *
   * Read from the same message array the transcript comes from — the provider
   * has been storing every tool call and result all along and nothing looked at
   * them. Reading them is how we found an agent telling a caller it had noted a
   * callback without ever calling the note tool.
   */
  const typeByName = Object.fromEntries(
    readConfig(call.agent?.config).tools.map(t => [t.name, t.type])
  )
  const actions = readActions(call.messages, typeByName)
  const claims  = findUnbackedClaims(call.messages, actions)

  const analysis = (call.analysis ?? null) as
    | { structuredData?: unknown; successEvaluation?: unknown }
    | null

  const structured =
    analysis?.structuredData && typeof analysis.structuredData === "object"
      ? (analysis.structuredData as Record<string, unknown>)
      : null

  const success = analysis?.successEvaluation ?? null

  const facts: [string, React.ReactNode][] = [
    ["Agent",      agentName],
    ["Number",     call.phoneNumber?.phoneNumber ?? "—"],
    ["Caller",     call.callerNumber ?? "Web call"],
    ["Direction",  titleCase(call.direction)],
    ["Started",    dateTime(call.startedAt)],
    ["Ended",      dateTime(call.endedAt)],
    ["Duration",   duration(call.durationSeconds)],
    ["Billed",     `${call.minutesBilled} min`],
    ["Cost",       usd(call.costCents)],
    ...(call.endedReason
      ? ([["Ended because", titleCase(call.endedReason)]] as [string, React.ReactNode][])
      : []),
  ]

  return (
    <AppShell
      nav={tenantNav("calls")}
      heading="Call detail"
      description={dateTime(call.startedAt ?? call.createdAt)}
      userEmail={email}
      actions={
        <Link
          href="/dashboard/calls"
          className="inline-flex h-10 items-center rounded-field border border-line-strong bg-field px-4 text-[13px] font-medium transition-colors hover:bg-field-hover"
        >
          Back to calls
        </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Summary — the fastest way to know what happened */}
          {call.summary && (
            <Card title="Summary">
              <p className="px-5 py-5 text-[13.5px] leading-relaxed text-muted">
                {call.summary}
              </p>
            </Card>
          )}

          {/* What actually happened, before the transcript — a person opening
              this page is usually asking whether the agent did its job, and the
              transcript reads convincingly either way. */}
          <CallActions actions={actions} claims={claims} />

          {/* Recording */}
          <Card title="Recording">
            <div className="px-5 py-5">
              {call.recordingUrl ? (
                <div className="space-y-3">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio controls preload="none" src={call.recordingUrl} className="w-full">
                    Your browser does not support audio playback.
                  </audio>
                  <a
                    href={call.recordingUrl}
                    download
                    className="inline-flex h-9 items-center rounded-field border border-line-strong bg-field px-3.5 text-[12.5px] font-medium transition-colors hover:bg-field-hover"
                  >
                    Download recording
                  </a>
                </div>
              ) : (
                <p className="text-[13px] text-subtle">
                  No recording for this call. Recording is set per agent and can be
                  turned on from the agent&rsquo;s settings.
                </p>
              )}
            </div>
          </Card>

          {/* Transcript — turn by turn where we have it */}
          <Card title="Transcript">
            <div className="px-5 py-5">
              {turns.length > 0 ? (
                <div className="max-h-[560px] space-y-3 overflow-y-auto">
                  {turns.map((t, i) => {
                    const isCaller = t.role === "user"
                    return (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={
                              isCaller
                                ? "text-[11px] font-medium uppercase tracking-[0.1em] text-subtle"
                                : "text-[11px] font-medium uppercase tracking-[0.1em] text-brand-on-tint"
                            }
                          >
                            {speaker(t.role, agentName)}
                          </span>
                          {typeof t.secondsFromStart === "number" && (
                            <span className="text-[11px] tabular-nums text-subtle">
                              {duration(Math.round(t.secondsFromStart))}
                            </span>
                          )}
                        </div>
                        <p className="text-[13.5px] leading-relaxed text-muted">{t.message}</p>
                      </div>
                    )
                  })}
                </div>
              ) : call.transcript ? (
                <pre className="max-h-[560px] overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-muted">
                  {call.transcript}
                </pre>
              ) : (
                <p className="text-[13px] text-subtle">
                  No transcript for this call. Transcription is set per agent.
                </p>
              )}
            </div>
          </Card>

          {/* Extracted data */}
          {structured && Object.keys(structured).length > 0 && (
            <Card title="Extracted data">
              <dl className="px-5 py-2">
                {Object.entries(structured).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-4 border-b border-line-soft py-3 last:border-b-0"
                  >
                    <dt className="shrink-0 text-[12.5px] text-subtle">{titleCase(key)}</dt>
                    <dd className="text-right text-[13px] break-words">
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value ?? "—")}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>

        {/* Facts */}
        <div className="space-y-5">
          <Card title="Details">
            <dl className="px-5 py-2">
              <div className="flex items-center justify-between border-b border-line-soft py-3">
                <dt className="text-[12.5px] text-subtle">Status</dt>
                <dd>
                  <Pill tone={callTone(call.status)}>{titleCase(call.status)}</Pill>
                </dd>
              </div>
              {success !== null && success !== undefined && (
                <div className="flex items-center justify-between border-b border-line-soft py-3">
                  <dt className="text-[12.5px] text-subtle">Outcome</dt>
                  <dd>
                    <Pill
                      tone={
                        success === true || success === "true" || success === "success"
                          ? "success"
                          : "neutral"
                      }
                    >
                      {typeof success === "boolean"
                        ? success ? "Successful" : "Unsuccessful"
                        : String(success)}
                    </Pill>
                  </dd>
                </div>
              )}
              {facts.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-b border-line-soft py-3 last:border-b-0"
                >
                  <dt className="shrink-0 text-[12.5px] text-subtle">{label}</dt>
                  <dd className="truncate text-right text-[13px]">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
