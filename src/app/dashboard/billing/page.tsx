import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { AppShell, StatCard } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { InfoNote, ErrorNote } from "@/components/ui/field"
import { usd, dateTime, dateOnly, titleCase } from "@/lib/format"
import { stripeConfigured } from "@/lib/stripe"
import { readAllowance, minutesLabel } from "@/lib/billing/allowance"
import { subscriptionIsLive } from "@/lib/billing/subscription"
import { TopUp } from "./topup"
import { Plans } from "./plans"
import { SubscriptionControls } from "./subscription-card"

export const metadata: Metadata = { title: "Billing" }
export const dynamic = "force-dynamic"

type Search = Promise<{ topup?: string; plan?: string; card?: string }>

export default async function BillingPage({ searchParams }: { searchParams: Search }) {
  const { tenant, email } = await requireTenant()
  const sp = await searchParams

  const [ledger, payments, plans, settings] = await Promise.all([
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
    prisma.platformSettings.findFirst({ where: { id: true } }),
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

  /*
   * A subscription is *how the plan is paid for*, never *whether there is a
   * plan*. An operator can grant a package outright, and that tenant has no
   * subscription and must still see a working billing page — so everything
   * below reads `tenant.package` for the allowance and the subscription fields
   * only for the parts that are genuinely about the payment arrangement.
   */
  const live      = subscriptionIsLive(tenant.subscriptionStatus)
  const renewsOn  = tenant.currentPeriodEnd ? dateOnly(tenant.currentPeriodEnd) : null
  const cancelling = live && tenant.cancelAtPeriodEnd
  const pastDue   = tenant.subscriptionStatus === "PAST_DUE"

  /*
   * The low-balance warning: it warns, and that is all it does.
   *
   * There is no auto top-up anywhere in this platform, by choice. A dialer that
   * can charge a card on its own is a dialer that can spend an unbounded amount
   * of somebody's money while they sleep, and no amount of convenience is worth
   * being the company that did that.
   *
   * Only meaningful once there is a rate to convert against — with no plan and
   * no rate, "$4 left" cannot be turned into an amount of calling and a warning
   * would be guesswork.
   */
  const lowPct = settings?.lowBalancePct ?? 20
  const threshold = tenant.package ? Math.round((tenant.package.priceCents * lowPct) / 100) : 0
  const lowBalance =
    a.canCall &&
    threshold > 0 &&
    a.minutesRemaining === 0 &&
    a.balanceCents > 0 &&
    a.balanceCents <= threshold

  return (
    <AppShell
      nav={tenantNav("billing")}
      heading="Billing"
      description="Your plan, balance and payment history."
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
      {sp.card === "success" && (
        <div className="mb-5">
          <InfoNote>
            Card saved. Your next renewal will be taken from it.
          </InfoNote>
        </div>
      )}
      {sp.card === "cancelled" && (
        <div className="mb-5">
          <InfoNote>Your payment method is unchanged.</InfoNote>
        </div>
      )}

      {/* Calls actually stopped. The loudest thing on the page. */}
      {a.stoppedReason && (
        <div className="mb-5">
          <ErrorNote>
            {a.stoppedReason} Add credit or choose a plan to bring your agents back
            online.
          </ErrorNote>
        </div>
      )}

      {/* A renewal that failed. Said plainly, while nothing has stopped yet —
          that is the whole value of telling them now rather than later. */}
      {pastDue && (
        <div className="mb-5">
          <ErrorNote>
            We couldn&rsquo;t take your last plan payment. Nothing has stopped and
            we&rsquo;ll keep trying over the next few days — updating your card now
            means you won&rsquo;t have to think about it again.
          </ErrorNote>
        </div>
      )}

      {cancelling && (
        <div className="mb-5">
          <InfoNote>
            Your plan is set to end{renewsOn ? ` on ${renewsOn}` : ""}. You keep
            every included minute until then, and you can change your mind at any
            point before it.
          </InfoNote>
        </div>
      )}

      {lowBalance && (
        <div className="mb-5">
          <InfoNote>
            You&rsquo;ve used this month&rsquo;s included minutes and your balance is
            down to {usd(a.balanceCents)} — about {minutesLabel(a.balanceMinutes)} of
            calling. Nothing is charged automatically, so top up when you&rsquo;re
            ready.
          </InfoNote>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Plan"
          value={tenant.package?.name ?? "None"}
          meta={
            a.includedMinutes === 0
              ? "Choose one below"
              : cancelling
                ? renewsOn ? `Ends ${renewsOn}` : "Ends at the end of this month"
                : live && renewsOn
                  ? `Renews ${renewsOn}`
                  : `${minutesLabel(a.includedMinutes)} included`
          }
        />
        <StatCard
          label="Minutes used"
          value={a.minutesUsed.toLocaleString()}
          meta={
            a.includedMinutes > 0
              ? `${a.usedPct}% of this month · ${minutesLabel(a.minutesRemaining)} left`
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
            live || tenant.stripeCustomerId ? (
              <SubscriptionControls
                cancelAtPeriodEnd={tenant.cancelAtPeriodEnd}
                periodEndLabel={renewsOn}
                canManage={live && stripeConfigured()}
              />
            ) : a.totalMinutesLeft > 0 ? (
              <span className="text-[12px] text-subtle">
                {minutesLabel(a.totalMinutesLeft)} left in total
              </span>
            ) : undefined
          }
        >
          <Plans
            plans={plans}
            currentId={tenant.packageId}
            subscribed={live}
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
                        <Pill tone={entry.amountCents > 0 ? "success" : "neutral"}>
                          {titleCase(entry.type)}
                        </Pill>
                      </TD>
                      <TD muted className="max-w-[280px] truncate">
                        {entry.description ?? "—"}
                      </TD>
                      <TD
                        align="right"
                        className={entry.amountCents > 0 ? "text-success" : undefined}
                      >
                        {/* A plan renewal is a real event with no credit
                            movement. Showing it as "+$0.00" reads like a bug. */}
                        {entry.amountCents === 0
                          ? "—"
                          : `${entry.amountCents > 0 ? "+" : "−"}${usd(Math.abs(entry.amountCents))}`}
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
                      <TD muted>
                        {p.type === "SUBSCRIPTION"
                          ? "Monthly plan"
                          : p.type === "TOP_UP"
                            ? "Top-up"
                            : "Plan"}
                      </TD>
                      <TD>
                        <Pill
                          tone={
                            p.status === "COMPLETED"
                              ? "success"
                              : p.status === "FAILED" || p.status === "DISPUTED"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {titleCase(p.status)}
                        </Pill>
                      </TD>
                      <TD align="right">
                        {usd(p.amountCents)}
                        {/* A partial refund leaves the row COMPLETED, which is
                            honest but incomplete on its own. */}
                        {p.refundedCents > 0 && p.refundedCents < p.amountCents && (
                          <span className="block text-[11.5px] text-subtle">
                            {usd(p.refundedCents)} refunded
                          </span>
                        )}
                      </TD>
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
