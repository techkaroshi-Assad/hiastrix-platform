import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { Page } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow, callTone } from "@/components/app/table"
import { usd, duration, dateTime, titleCase } from "@/lib/format"
import { CallFilters } from "./filters"
import { IconMic, IconTranscript } from "@/components/app/icons"

export const metadata: Metadata = { title: "Calls" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

type Search = Promise<{
  agent?: string
  status?: string
  from?: string
  to?: string
  page?: string
}>

export default async function CallsPage({ searchParams }: { searchParams: Search }) {
  const { tenant } = await requireTenant()
  const sp = await searchParams

  const page = Math.max(1, Number(sp.page ?? "1") || 1)

  // Every filter is additionally constrained by tenantId, so a crafted
  // agent id from another tenant simply matches nothing.
  const where: Record<string, unknown> = { tenantId: tenant.id }
  if (sp.agent)  where.agentId = sp.agent
  if (sp.status) where.status = sp.status

  if (sp.from || sp.to) {
    const range: { gte?: Date; lte?: Date } = {}
    if (sp.from) range.gte = new Date(`${sp.from}T00:00:00`)
    if (sp.to)   range.lte = new Date(`${sp.to}T23:59:59.999`)
    where.createdAt = range
  }

  const [calls, total, agents, everAny] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        agent:       { select: { name: true } },
        phoneNumber: { select: { phoneNumber: true } },
      },
    }),
    prisma.call.count({ where }),
    prisma.agent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    /* Deliberately unfiltered.
     *
     * "No calls match this view yet" is the same sentence whether the tenant
     * has never made a call or has simply filtered to a Tuesday in March, and
     * those need completely different answers — one is "here's how to get
     * started", the other is "clear the filter". This platform has shipped that
     * exact confusion three times now (a tag that matched nobody, a CRM error
     * shown as an empty list, a campaign outside its calling window all read as
     * "0"), so the count that tells them apart is worth one extra query. */
    prisma.call.count({ where: { tenantId: tenant.id } }),
  ])

  const filtered = Boolean(sp.agent || sp.status || sp.from || sp.to)

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const qs = (p: number) => {
    const next = new URLSearchParams()
    if (sp.agent)  next.set("agent", sp.agent)
    if (sp.status) next.set("status", sp.status)
    if (sp.from)   next.set("from", sp.from)
    if (sp.to)     next.set("to", sp.to)
    if (p > 1)     next.set("page", String(p))
    const s = next.toString()
    return s ? `/dashboard/calls?${s}` : "/dashboard/calls"
  }

  return (
    <Page
      heading="Calls"
      description="Every call your agents have handled."
    >
      <div className="mb-5">
        <CallFilters agents={agents} />
      </div>

      <Card
        title={`${total.toLocaleString()} call${total === 1 ? "" : "s"}`}
        action={
          pages > 1 ? (
            <span className="text-[12.5px] text-subtle">
              Page {page} of {pages}
            </span>
          ) : undefined
        }
      >
        <Table>
          <thead>
            <tr>
              <TH>When</TH>
              <TH>Agent</TH>
              <TH>From</TH>
              <TH>Direction</TH>
              <TH>Status</TH>
              <TH>Media</TH>
              <TH align="right">Duration</TH>
              <TH align="right">Cost</TH>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 ? (
              <EmptyRow colSpan={8}>
                {everAny === 0
                  ? "No calls yet. Once an agent answers or places one, it appears here with its recording, transcript and cost."
                  : filtered
                    ? "No calls match these filters. Try widening the dates, or clearing them."
                    : "No calls on this page."}
              </EmptyRow>
            ) : (
              calls.map(call => (
                <tr key={call.id} className="transition-colors hover:bg-field-soft">
                  <TD>
                    <Link
                      href={`/dashboard/calls/${call.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {dateTime(call.startedAt ?? call.createdAt)}
                    </Link>
                  </TD>
                  <TD muted>{call.agent?.name ?? "—"}</TD>
                  <TD muted>{call.callerNumber ?? "Web"}</TD>
                  <TD muted>{titleCase(call.direction)}</TD>
                  <TD>
                    <Pill tone={callTone(call.status)}>{titleCase(call.status)}</Pill>
                  </TD>
                  <TD>
                    {/* Recording and transcript live on the detail page; this
                        just says whether there is anything to open. */}
                    <span className="flex items-center gap-2 text-subtle">
                      {call.recordingUrl && (
                        <span title="Recording available" aria-label="Recording available">
                          <IconMic size={15} />
                        </span>
                      )}
                      {call.transcript && (
                        <span title="Transcript available" aria-label="Transcript available">
                          <IconTranscript size={15} />
                        </span>
                      )}
                      {!call.recordingUrl && !call.transcript && (
                        <span className="text-[12px]">—</span>
                      )}
                    </span>
                  </TD>
                  <TD align="right">{duration(call.durationSeconds)}</TD>
                  <TD align="right">{usd(call.costCents)}</TD>
                </tr>
              ))
            )}
          </tbody>
        </Table>

        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            {page > 1 ? (
              <Link
                href={qs(page - 1)}
                className="rounded-field border border-line-strong bg-field px-3.5 py-2 text-[13px] transition-colors hover:bg-field-hover"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            {page < pages && (
              <Link
                href={qs(page + 1)}
                className="rounded-field border border-line-strong bg-field px-3.5 py-2 text-[13px] transition-colors hover:bg-field-hover"
              >
                Next
              </Link>
            )}
          </div>
        )}
      </Card>
    </Page>
  )
}
