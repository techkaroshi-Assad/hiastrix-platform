import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, StatCard } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { campaignReadiness } from "@/lib/dialer/readiness"
import { whyIdle } from "@/lib/dialer/idle"
import { CampaignControls, LeadImport, LiveRefresh } from "./campaign-client"
import { leadTone, LEAD_LABEL } from "../tones"

export const metadata: Metadata = { title: "Campaign" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

type Search = Promise<{ state?: string; page?: string }>

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Search
}) {
  const { id } = await params
  const sp = await searchParams
  const { tenant, email } = await requireTenant()

  const campaign = await prisma.campaign.findFirst({
    where:   { id, tenantId: tenant.id },
    include: {
      agent:       { select: { id: true, name: true, status: true } },
      phoneNumber: { select: { phoneNumber: true } },
    },
  })
  if (!campaign) notFound()

  const page = Math.max(1, Number(sp.page ?? "1") || 1)

  // Every filter is additionally constrained by the campaign, which is itself
  // constrained by the tenant above — so a crafted state from another workspace
  // simply matches nothing.
  const where: Record<string, unknown> = { campaignId: campaign.id }
  if (sp.state) where.state = sp.state

  const [counts, leads, total, dialled, readiness, idle] = await Promise.all([
    prisma.campaignLead.groupBy({
      by: ["state"],
      where: { campaignId: campaign.id },
      _count: { _all: true },
    }),
    prisma.campaignLead.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, phoneE164: true, contactName: true, state: true,
        attemptNo: true, lastOutcome: true, note: true,
        nextAttemptAt: true, updatedAt: true,
      },
    }),
    prisma.campaignLead.count({ where }),
    prisma.dialAttempt.count({ where: { campaignId: campaign.id } }),
    // Shown as a warning before anyone presses start, rather than as an error
    // afterwards.
    campaign.state === "RUNNING" ? Promise.resolve({ ok: true as const }) : campaignReadiness(campaign.id),
    // And once it IS running: why is nothing happening this minute?
    //
    // A campaign with sixty-eight people loaded, an active agent, a number and
    // a healthy balance sat reading "0 spoke to" while the dialer refused it
    // every minute — correctly, because the local time was 21:31 and the window
    // closed at 19:00. The engine was right and looked broken. Nothing on this
    // page said which.
    whyIdle(campaign.id),
  ])

  const countOf = (s: string) => counts.find(c => c.state === s)?._count._all ?? 0
  const all = counts.reduce((n, c) => n + c._count._all, 0)

  const finished = ["COMPLETED", "EXHAUSTED", "FAILED", "SUPPRESSED", "CANCELLED"]
    .reduce((n, s) => n + countOf(s), 0)
  const live = countOf("DIALING") + countOf("IN_PROGRESS")
  const waiting = countOf("PENDING") + countOf("RETRY_WAIT") + countOf("DEFERRED")
  const pct = all ? Math.round((finished / all) * 100) : 0

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const qs = (p: number) => {
    const q = new URLSearchParams()
    if (sp.state) q.set("state", sp.state)
    if (p > 1) q.set("page", String(p))
    const s = q.toString()
    return `/dashboard/campaigns/${campaign.id}${s ? `?${s}` : ""}`
  }

  return (
    <AppShell
      nav={tenantNav("campaigns")}
      heading={campaign.name}
      description={
        `${campaign.agent.name} · ${campaign.windowStart}–${campaign.windowEnd} ` +
        `${campaign.timezone.replace(/_/g, " ")} · ` +
        (campaign.phoneNumber
          ? `calling from ${campaign.phoneNumber.phoneNumber}`
          : "rotating across its agent's numbers")
      }
      userEmail={email}
      actions={
        <CampaignControls
          id={campaign.id}
          state={campaign.state}
          notReadyReason={readiness.ok ? null : readiness.reason}
          hasLeads={all > 0}
          canDelete={dialled === 0}
        />
      }
    >
      {/* Only while something is actually happening — a finished campaign has
          no reason to keep asking the server whether it has changed. */}
      {campaign.state === "RUNNING" && <LiveRefresh />}

      {/* Why nothing is happening. Above the numbers, because the numbers are
          what prompted the question. */}
      {idle && !campaign.pausedReason && (
        <div
          className={
            idle.normal
              ? "mb-5 rounded-2xl border border-line bg-field-soft px-5 py-4"
              : "mb-5 rounded-2xl border border-warning/40 bg-warning/[0.08] px-5 py-4"
          }
        >
          <p className={idle.normal ? "text-[13px] font-medium" : "text-[13px] font-medium text-warning"}>
            {idle.label}
          </p>
          <p className="mt-1 text-[13px] font-light leading-relaxed text-muted">{idle.detail}</p>
        </div>
      )}

      {campaign.pausedReason && (
        <div className="mb-5 rounded-2xl border border-warning/25 bg-warning/10 px-5 py-4">
          <p className="text-[13px] text-warning">{campaign.pausedReason}</p>
        </div>
      )}

      {!readiness.ok && campaign.state !== "COMPLETED" && campaign.state !== "ARCHIVED" && (
        <div className="mb-5 rounded-2xl border border-line bg-field-soft px-5 py-4">
          <p className="text-[13px] font-medium">Before this can start</p>
          <p className="mt-1 text-[13px] font-light text-muted">{readiness.reason}</p>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="People" value={all.toLocaleString()}
                  meta={`${waiting.toLocaleString()} still to call`} />
        <StatCard label="Spoke to" value={countOf("COMPLETED").toLocaleString()}
                  meta={all ? `${Math.round((countOf("COMPLETED") / all) * 100)}% of the list` : undefined} />
        <StatCard label="On the phone now" value={live.toLocaleString()}
                  meta={campaign.state === "RUNNING" ? "updating live" : "not running"} />
        <StatCard label="Finished" value={`${pct}%`}
                  meta={`${finished.toLocaleString()} of ${all.toLocaleString()}`} />
      </div>

      <div
        className="mb-6 h-2 w-full overflow-hidden rounded-full bg-field-hover"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Campaign progress"
      >
        <div
          className="h-full rounded-full bg-linear-to-r from-brand-400 to-brand-600 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {all === 0 ? (
        <Card title="Add the people to call">
          <div className="px-5 py-6">
            <LeadImport
              campaignId={campaign.id}
              crmConnected={Boolean(tenant.crmLocationId)}
              countryCode={tenant.defaultCountryCode}
            />
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/campaigns/${campaign.id}`}
              className={`rounded-field border px-3 py-1.5 text-[12.5px] transition-colors ${
                !sp.state
                  ? "border-brand-500/60 bg-brand-500/12 text-brand-on-tint"
                  : "border-line bg-field text-muted hover:border-line-strong"
              }`}
            >
              Everyone <span className="tabular-nums text-subtle">{all}</span>
            </Link>
            {counts
              .filter(c => c._count._all > 0)
              .sort((a, b) => b._count._all - a._count._all)
              .map(c => (
                <Link
                  key={c.state}
                  href={`/dashboard/campaigns/${campaign.id}?state=${c.state}`}
                  className={`rounded-field border px-3 py-1.5 text-[12.5px] transition-colors ${
                    sp.state === c.state
                      ? "border-brand-500/60 bg-brand-500/12 text-brand-on-tint"
                      : "border-line bg-field text-muted hover:border-line-strong"
                  }`}
                >
                  {LEAD_LABEL[c.state] ?? c.state}{" "}
                  <span className="tabular-nums text-subtle">{c._count._all}</span>
                </Link>
              ))}

            <div className="ml-auto">
              <LeadImport
                campaignId={campaign.id}
                crmConnected={Boolean(tenant.crmLocationId)}
                countryCode={tenant.defaultCountryCode}
                compact
              />
            </div>
          </div>

          <Card title={`${total.toLocaleString()} ${total === 1 ? "person" : "people"}`}>
            <Table>
              <thead>
                <tr>
                  <TH>Person</TH>
                  <TH>Status</TH>
                  <TH align="right">Attempts</TH>
                  <TH align="right">What happened</TH>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 ? (
                  <EmptyRow colSpan={4}>Nobody in this group.</EmptyRow>
                ) : (
                  leads.map(l => (
                    <tr key={l.id} className="transition-colors hover:bg-field-soft">
                      <TD>
                        <span className="font-medium">{l.contactName ?? "—"}</span>
                        <span className="ml-2 tabular-nums text-[12px] text-muted">{l.phoneE164}</span>
                      </TD>
                      <TD>
                        <Pill tone={leadTone(l.state)}>{LEAD_LABEL[l.state] ?? l.state}</Pill>
                      </TD>
                      <TD align="right" muted className="tabular-nums">{l.attemptNo}</TD>
                      <TD align="right" muted>
                        {l.note ?? (l.state === "PENDING" ? "Not called yet" : "—")}
                      </TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>

          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between" aria-label="Pages">
              <span className="text-[12.5px] font-light text-muted">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={qs(page - 1)}
                    className="rounded-field border border-line bg-field px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-line-strong"
                  >
                    Previous
                  </Link>
                )}
                {page < pages && (
                  <Link
                    href={qs(page + 1)}
                    className="rounded-field border border-line bg-field px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-line-strong"
                  >
                    Next
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </AppShell>
  )
}
