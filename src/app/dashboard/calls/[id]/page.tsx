import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell } from "@/components/app/app-shell"
import { Card, Pill, callTone } from "@/components/app/table"
import { usd, duration, dateTime, titleCase } from "@/lib/format"

export const metadata: Metadata = { title: "Call detail" }
export const dynamic = "force-dynamic"

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
      agent:       { select: { name: true } },
      phoneNumber: { select: { phoneNumber: true } },
    },
  })

  if (!call) notFound()

  const facts: [string, React.ReactNode][] = [
    ["Agent",      call.agent?.name ?? "—"],
    ["Number",     call.phoneNumber?.phoneNumber ?? "—"],
    ["Caller",     call.callerNumber ?? "Web call"],
    ["Direction",  titleCase(call.direction)],
    ["Started",    dateTime(call.startedAt)],
    ["Ended",      dateTime(call.endedAt)],
    ["Duration",   duration(call.durationSeconds)],
    ["Billed",     `${call.minutesBilled} min`],
    ["Cost",       usd(call.costCents)],
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
          className="inline-flex h-10 items-center rounded-field border border-white/[0.12] bg-white/[0.04] px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.07]"
        >
          Back to calls
        </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
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
                    className="inline-flex h-9 items-center rounded-field border border-white/[0.12] bg-white/[0.04] px-3.5 text-[12.5px] font-medium transition-colors hover:bg-white/[0.07]"
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

          {/* Transcript */}
          <Card title="Transcript">
            <div className="px-5 py-5">
              {call.transcript ? (
                <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-muted">
                  {call.transcript}
                </pre>
              ) : (
                <p className="text-[13px] text-subtle">
                  No transcript for this call. Transcription is set per agent.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Facts */}
        <Card title="Details">
          <dl className="px-5 py-2">
            <div className="flex items-center justify-between border-b border-white/[0.04] py-3">
              <dt className="text-[12.5px] text-subtle">Status</dt>
              <dd>
                <Pill tone={callTone(call.status)}>{titleCase(call.status)}</Pill>
              </dd>
            </div>
            {facts.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 border-b border-white/[0.04] py-3 last:border-b-0"
              >
                <dt className="shrink-0 text-[12.5px] text-subtle">{label}</dt>
                <dd className="truncate text-right text-[13px]">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </AppShell>
  )
}
