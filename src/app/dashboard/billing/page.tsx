import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, StatCard } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { InfoNote, ErrorNote } from "@/components/ui/field"
import { usd, dateTime, titleCase } from "@/lib/format"
import { stripeConfigured } from "@/lib/stripe"
import { TopUp } from "./topup"

export const metadata: Metadata = { title: "Billing" }
export const dynamic = "force-dynamic"

type Search = Promise<{ topup?: string }>

export default async function BillingPage({ searchParams }: { searchParams: Search }) {
  const { tenant, email } = await requireTenant()
  const sp = await searchParams

  const [ledger, payments] = await Promise.all([
    prisma.creditLedger.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.payment.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ])

  const cap         = tenant.package?.minutesIncluded ?? 0
  const rate        = tenant.package?.overageRateCents ?? 0
  const used        = tenant.minutesUsed
  const overage     = Math.max(0, used - cap)
  const overageCost = overage * rate
  const balance     = tenant.creditBalanceCents
  const pct         = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0

  return (
    <AppShell
      nav={tenantNav("billing")}
      heading="Billing"
      description="Your package, balance and payment history."
      userEmail={email}
    >
      {sp.topup === "success" && (
        <div className="mb-5">
          <InfoNote>
            Payment received. Your balance updates within a few seconds — refresh if
            you don&rsquo;t see it yet.
          </InfoNote>
        </div>
      )}
      {sp.topup === "cancelled" && (
        <div className="mb-5">
          <InfoNote>Top-up cancelled. Nothing was charged.</InfoNote>
        </div>
      )}
      {balance <= 0 && (
        <div className="mb-5">
          <ErrorNote>
            Your balance is empty, so calls are paused. Top up to bring your agents
            back online.
          </ErrorNote>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Package"
          value={tenant.package?.name ?? "None"}
          meta={cap > 0 ? `${cap.toLocaleString()} minutes included` : "Not assigned yet"}
        />
        <StatCard
          label="Minutes used"
          value={used.toLocaleString()}
          meta={cap > 0 ? `${pct}% of your allowance` : "No allowance set"}
        />
        <StatCard
          label="Overage"
          value={overage > 0 ? `${overage.toLocaleString()} min` : "—"}
          meta={overage > 0 ? `${usd(overageCost)} at ${usd(rate)}/min` : "Within allowance"}
        />
        <StatCard
          label="Balance"
          value={usd(balance)}
          meta={balance <= 0 ? "Calls paused" : "Available credit"}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {/* Credit ledger */}
          <Card title="Credit history">
            <Table>
              <thead>
                <tr>
                  <TH>When</TH>
                  <TH>Type</TH>
                  <TH>Description</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <EmptyRow colSpan={4}>No credit activity yet.</EmptyRow>
                ) : (
                  ledger.map(entry => (
                    <tr key={entry.id} className="transition-colors hover:bg-field-soft">
                      <TD muted>{dateTime(entry.createdAt)}</TD>
                      <TD>
                        <Pill tone={entry.amountCents >= 0 ? "success" : "neutral"}>
                          {titleCase(entry.type)}
                        </Pill>
                      </TD>
                      <TD muted className="max-w-[280px] truncate">
                        {entry.description ?? "—"}
                      </TD>
                      <TD
                        align="right"
                        className={entry.amountCents >= 0 ? "text-success" : undefined}
                      >
                        {entry.amountCents >= 0 ? "+" : "−"}
                        {usd(Math.abs(entry.amountCents))}
                      </TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>

          {/* Payments */}
          <Card title="Payments">
            <Table>
              <thead>
                <tr>
                  <TH>When</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <EmptyRow colSpan={4}>No payments yet.</EmptyRow>
                ) : (
                  payments.map(p => (
                    <tr key={p.id} className="transition-colors hover:bg-field-soft">
                      <TD muted>{dateTime(p.createdAt)}</TD>
                      <TD muted>{titleCase(p.type)}</TD>
                      <TD>
                        <Pill
                          tone={
                            p.status === "COMPLETED"
                              ? "success"
                              : p.status === "FAILED"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {titleCase(p.status)}
                        </Pill>
                      </TD>
                      <TD align="right">{usd(p.amountCents)}</TD>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </div>

        <Card title="Add credit" className="self-start">
          <TopUp enabled={stripeConfigured() && tenant.status !== "BLOCKED"} />
        </Card>
      </div>
    </AppShell>
  )
}
