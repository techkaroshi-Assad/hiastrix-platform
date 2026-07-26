import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, StatCard } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { InfoNote, ErrorNote } from "@/components/ui/field"
import { usd, dateTime, titleCase } from "@/lib/format"
import { stripeConfigured } from "@/lib/stripe"
import { readAllowance, minutesLabel } from "@/lib/billing/allowance"
import { TopUp } from "./topup"
import { Plans } from "./plans"

export const metadata: Metadata = { title: "Billing" }
export const dynamic = "force-dynamic"

type Search = Promise<{ topup?: string; plan?: string }>

export default async function BillingPage({ searchParams }: { searchParams: Search }) {
  const { tenant, email } = await requireTenant()
  const sp = await searchParams

  const [ledger, payments, plans] = await Promise.all([
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
    prisma.package.findMany({
      where:   { isActive: true },
      orderBy: { priceCents: "asc" },
      select:  {
        id: true, name: true, minutesIncluded: true,
        priceCents: true, overageRateCents: true,
      },
    }),
  ])

  /*
   * One place decides what the numbers mean, so the stat row, the warning banner
   * and the agent-pausing rule cannot disagree. In particular "calls are paused"
   * is NOT "balance is zero" — a tenant who has just bought a plan sits at full
   * allowance and no credit, and is perfectly able to call.
   */
  const a = readAllowance({
    includedMinutes:  tenant.package?.minutesIncluded ?? 0,
    overageRateCents: tenant.package?.overageRateCents ?? 0,
    minutesUsed:      tenant.minutesUsed,
    balanceCents:     tenant.creditBalanceCents,
  })
  const overageCost = a.overageMinutes * a.overageRateCents

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
      {sp.plan === "success" && (
        <div className="mb-5">
          <InfoNote>
            Payment received. Your plan activates within a few seconds — refresh if
            you don&rsquo;t see it yet.
          </InfoNote>
        </div>
      )}
      {sp.plan === "cancelled" && (
        <div className="mb-5">
          <InfoNote>Nothing was charged and your plan is unchanged.</InfoNote>
        </div>
      )}
      {a.stoppedReason && (
        <div className="mb-5">
          <ErrorNote>
            {a.stoppedReason} Add credit or choose a plan to bring your agents back
            online.
          </ErrorNote>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Plan"
          value={tenant.package?.name ?? "None"}
          meta={
            a.includedMinutes > 0
              ? `${minutesLabel(a.includedMinutes)} included`
              : "Choose one below"
          }
        />
        <StatCard
          label="Minutes used"
          value={a.minutesUsed.toLocaleString()}
          meta={
            a.includedMinutes > 0
              ? `${a.usedPct}% of your allowance · ${minutesLabel(a.minutesRemaining)} left`
              : "No allowance set"
          }
        />
        <StatCard
          label="Overage"
          value={a.overageMinutes > 0 ? minutesLabel(a.overageMinutes) : "—"}
          meta={
            a.overageMinutes > 0
              ? `${usd(overageCost)} at ${usd(a.overageRateCents)}/min`
              : "Within allowance"
          }
        />
        {/* Money and minutes together — "$1.30" alone tells nobody whether that
            is an afternoon or a fortnight. */}
        <StatCard
          label="Balance"
          value={usd(a.balanceCents)}
          meta={
            a.overageRateCents > 0
              ? `about ${minutesLabel(a.balanceMinutes)} at your rate`
              : "Available credit"
          }
        />
      </div>

      <div className="mt-5">
        <Card
          title="Plans"
          action={
            a.totalMinutesLeft > 0 ? (
              <span className="text-[12px] text-subtle">
                {minutesLabel(a.totalMinutesLeft)} left in total
              </span>
            ) : undefined
          }
        >
          <Plans
            plans={plans}
            currentId={tenant.packageId}
            enabled={stripeConfigured() && tenant.status === "ACTIVE"}
          />
        </Card>
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
          <TopUp enabled={stripeConfigured() && tenant.status !== "BLOCKED"} rateCents={a.overageRateCents} />
        </Card>
      </div>
    </AppShell>
  )
}
