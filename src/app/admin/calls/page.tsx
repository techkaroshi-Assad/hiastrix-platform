import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { adminNav } from "@/lib/nav-admin"
import { AppShell } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow, callTone } from "@/components/app/table"
import { usd, duration, dateTime, titleCase } from "@/lib/format"

export const metadata: Metadata = { title: "All calls" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

type Search = Promise<{ tenant?: string; status?: string; page?: string }>

export default async function AdminCallsPage({ searchParams }: { searchParams: Search }) {
  const admin = await requireAdmin()
  const sp = await searchParams

  const page = Math.max(1, Number(sp.page ?? "1") || 1)

  const where: Record<string, unknown> = {}
  if (sp.tenant) where.tenantId = sp.tenant
  if (sp.status) where.status = sp.status

  const [calls, total, tenants] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        tenant: { select: { id: true, companyName: true } },
        agent:  { select: { name: true } },
      },
    }),
    prisma.call.count({ where }),
    prisma.tenant.findMany({
      orderBy: { companyName: "asc" },
      select:  { id: true, companyName: true },
    }),
  ])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    const merged = { tenant: sp.tenant, status: sp.status, ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v)
    const s = next.toString()
    return s ? `/admin/calls?${s}` : "/admin/calls"
  }

  return (
    <AppShell
      nav={adminNav("calls")}
      heading="All calls"
      description="Every call across every tenant."
      userEmail={admin.email}
    >
      {/* Tenant filter — links keep this a server component. */}
      <div className="mb-5 flex flex-wrap gap-2">
        <Link
          href={link({ tenant: undefined })}
          className={
            sp.tenant
              ? "rounded-field border border-line-strong bg-field px-3.5 py-2 text-[12.5px] transition-colors hover:bg-field-hover"
              : "rounded-field border border-brand-500/50 bg-brand-500/12 px-3.5 py-2 text-[12.5px] text-brand-200"
          }
        >
          All tenants
        </Link>
        {tenants.map(t => (
          <Link
            key={t.id}
            href={link({ tenant: t.id })}
            className={
              sp.tenant === t.id
                ? "rounded-field border border-brand-500/50 bg-brand-500/12 px-3.5 py-2 text-[12.5px] text-brand-200"
                : "rounded-field border border-line-strong bg-field px-3.5 py-2 text-[12.5px] transition-colors hover:bg-field-hover"
            }
          >
            {t.companyName}
          </Link>
        ))}
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
              <TH>Tenant</TH>
              <TH>Agent</TH>
              <TH>Status</TH>
              <TH align="right">Duration</TH>
              <TH align="right">Cost</TH>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 ? (
              <EmptyRow colSpan={6}>No calls match this view.</EmptyRow>
            ) : (
              calls.map(c => (
                <tr key={c.id} className="transition-colors hover:bg-field-soft">
                  <TD muted>{dateTime(c.startedAt ?? c.createdAt)}</TD>
                  <TD>
                    <Link
                      href={`/admin/tenants/${c.tenantId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {c.tenant?.companyName ?? "—"}
                    </Link>
                  </TD>
                  <TD muted>{c.agent?.name ?? "—"}</TD>
                  <TD>
                    <Pill tone={callTone(c.status)}>{titleCase(c.status)}</Pill>
                  </TD>
                  <TD align="right">{duration(c.durationSeconds)}</TD>
                  <TD align="right">{usd(c.costCents)}</TD>
                </tr>
              ))
            )}
          </tbody>
        </Table>

        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            {page > 1 ? (
              <Link
                href={link({ page: String(page - 1) })}
                className="rounded-field border border-line-strong bg-field px-3.5 py-2 text-[13px] transition-colors hover:bg-field-hover"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            {page < pages && (
              <Link
                href={link({ page: String(page + 1) })}
                className="rounded-field border border-line-strong bg-field px-3.5 py-2 text-[13px] transition-colors hover:bg-field-hover"
              >
                Next
              </Link>
            )}
          </div>
        )}
      </Card>
    </AppShell>
  )
}
