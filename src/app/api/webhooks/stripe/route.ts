/**
 * POST /api/webhooks/stripe — where money actually moves.
 *
 * Nothing in this platform grants an allowance, credits a balance, or takes one
 * away except this file. A checkout redirect proves somebody reached a URL; an
 * API call returning 200 proves a request was accepted. Neither proves a
 * payment cleared, and only a payment clearing should change what a customer
 * can spend.
 *
 * The raw body is required for signature verification, so this route reads
 * text() and never json(). An unverified request is rejected outright — an
 * unsigned request that could credit an account is not something to be lenient
 * about.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 * Stripe retries. Every handler below has to survive being run twice on the
 * same event, and each one is pinned by a unique key rather than by a flag:
 *
 *   top-ups          unique on the payment intent
 *   plan invoices    unique on the invoice — including the monthly renewal,
 *                    which is why minutes cannot reset twice in a month
 *   refunds          the running total on the payment row, so a replay finds
 *                    nothing left to take back
 *
 * ── The one that would have been expensive ───────────────────────────────────
 * `payment_intent.succeeded` fires for subscription charges too. Left alone,
 * every monthly plan payment would have been read as a top-up and credited to
 * the balance — the customer would be handed their plan's price in call credit
 * every month, on top of the minutes they had just bought. The guard is that a
 * top-up is identified by metadata *we* put on the intent, and a subscription
 * charge carries none.
 */

import { NextRequest } from "next/server"
import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"
import {
  enableAllTenantAgents,
  disableAllTenantAgents,
  pauseTenantCampaigns,
} from "@/lib/billing/cap-enforcement"
import {
  tenantFieldsFrom,
  subscriptionIdOf,
  invoiceMetadata,
  paymentIntentOf,
  priceIdOf,
  periodEndOf,
  packageForPrice,
  resolveTenantId,
  customerIdOf,
  idOf,
  mapStatus,
} from "@/lib/billing/subscription"
import {
  sendTopUpConfirmed,
  sendPackageActivated,
  sendPlanRenewed,
  sendPaymentFailed,
  sendPlanEnded,
  sendRefundProcessed,
  billingRecipients,
} from "@/lib/email"

export const dynamic = "force-dynamic"

/** Prisma's unique-violation code, and Postgres's underneath it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string }
  return e?.code === "P2002" || e?.code === "23505"
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  const signature = request.headers.get("stripe-signature")

  if (!secret || !signature) return new Response(null, { status: 400 })

  let event: Stripe.Event
  try {
    const raw = await request.text()
    event = getStripe().webhooks.constructEvent(raw, signature, secret)
  } catch (error) {
    console.error("[webhooks/stripe/verify]", error)
    return new Response(null, { status: 400 })
  }

  try {
    switch (event.type) {
      /* ── Subscriptions ─────────────────────────────────────────────── */

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await syncSubscription(event.data.object as Stripe.Subscription)
        break

      case "customer.subscription.deleted":
        await endSubscription(event.data.object as Stripe.Subscription)
        break

      case "invoice.paid":
        await settleInvoice(event.data.object as Stripe.Invoice)
        break

      case "invoice.payment_failed":
        await noteFailedInvoice(event.data.object as Stripe.Invoice)
        break

      /* ── One-off charges: top-ups only ─────────────────────────────── */

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent

        /*
         * The guard described at the top of the file.
         *
         * A top-up carries a `tenantId` we put on the intent ourselves. A plan
         * charge is created by Stripe from an invoice, carries no metadata of
         * ours, and is settled by `invoice.paid` instead. Anything without our
         * marker is some other payment on this Stripe account and is not ours
         * to credit — so this is a positive test for what we recognise, not a
         * list of things to exclude.
         */
        if (!pi.metadata?.tenantId) break

        // The old one-off plan purchase. No longer sold, but an intent created
        // before the switch could still settle after it.
        if (pi.metadata.packageId) {
          await settleLegacyPackage({
            tenantId:    pi.metadata.tenantId,
            packageId:   pi.metadata.packageId,
            intentId:    pi.id,
            amountCents: pi.amount_received || pi.amount,
          })
        } else {
          await creditTenant({
            tenantId:    pi.metadata.tenantId,
            intentId:    pi.id,
            amountCents: pi.amount_received || pi.amount,
          })
        }
        break
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent
        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id, status: "PENDING" },
          data:  { status: "FAILED" },
        })
        break
      }

      /* ── Money going back ──────────────────────────────────────────── */

      case "charge.refunded":
        await applyRefund(event.data.object as Stripe.Charge)
        break

      case "charge.dispute.created":
        await applyDispute(event.data.object as Stripe.Dispute)
        break

      /* ── Checkout ──────────────────────────────────────────────────── */

      case "checkout.session.completed":
        await finishCheckout(event.data.object as Stripe.Checkout.Session)
        break

      default:
        break
    }

    return Response.json({ received: true })
  } catch (error) {
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    console.error("[webhooks/stripe]", event.type, error)
    return new Response(null, { status: 500 })
  }
}

/* ═══ Subscriptions ═════════════════════════════════════════════════════ */

/**
 * A subscription came into existence or changed shape.
 *
 * Records what Stripe says about it and, if the plan behind it moved, moves the
 * tenant's package with it. What it deliberately does **not** do is reset
 * minutes: this event fires for a card update, a cancellation being scheduled,
 * a proration, and half a dozen other things that are not the start of a new
 * month. Only a paid invoice starts a month, and that is handled below.
 */
async function syncSubscription(sub: Stripe.Subscription) {
  const tenantId = await resolveTenantId({
    metadataTenantId: sub.metadata?.tenantId,
    subscriptionId:   sub.id,
    customerId:       customerIdOf(sub.customer),
  })
  if (!tenantId) return

  // A subscription Stripe has finished with should end the allowance even when
  // it arrives as an update rather than a deletion — `unpaid` is Stripe giving
  // up after every retry failed, and `incomplete_expired` is a checkout whose
  // first payment never completed.
  if (sub.status === "canceled" || sub.status === "unpaid" || sub.status === "incomplete_expired") {
    await endSubscription(sub)
    return
  }

  const pkg = await packageForPrice(priceIdOf(sub))

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      ...tenantFieldsFrom(sub),
      /*
       * A plan switch lands here, and the tenant moves onto the new allowance
       * straight away — Stripe has already switched them and prorated the
       * money, so pretending otherwise would mean charging for one plan and
       * serving another.
       *
       * `minutesUsed` is not reset by a switch, on purpose. Minutes used this
       * month were used; upgrading gives a bigger cap, which is the right
       * answer for someone who upgraded *because* they ran out, and it stops
       * switching plans repeatedly from being a way to get free minutes.
       */
      ...(pkg ? { packageId: pkg.id } : {}),
    },
  })
}

/**
 * The plan is over.
 *
 * The allowance ends and nothing else does. Credit stays, agents stay,
 * campaigns stay, numbers stay. A tenant who lapses falls back to paying per
 * minute from whatever balance they hold, which is a working product rather
 * than a locked door — and the difference between those two is whether they
 * come back.
 */
async function endSubscription(sub: Stripe.Subscription) {
  const tenantId = await resolveTenantId({
    metadataTenantId: sub.metadata?.tenantId,
    subscriptionId:   sub.id,
    customerId:       customerIdOf(sub.customer),
  })
  if (!tenantId) return

  const before = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: {
      companyName: true,
      creditBalanceCents: true,
      packageId: true,
      package: { select: { name: true } },
    },
  })
  if (!before) return

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      packageId:          null,
      subscriptionStatus: mapStatus(sub.status),
      cancelAtPeriodEnd:  false,
      currentPeriodEnd:   periodEndOf(sub),
      // The id is kept. It is the audit trail for what the tenant was on, and
      // clearing it would make a replayed event unable to find them.
    },
  })

  if (!before.packageId) return

  const recipients = await billingRecipients(tenantId)
  if (recipients.length) {
    await sendPlanEnded({
      to: recipients,
      companyName:  before.companyName,
      packageName:  before.package?.name ?? "monthly",
      balanceCents: before.creditBalanceCents,
    })
  }
}

/**
 * An invoice was paid — the only thing that starts a month.
 *
 * Three billing reasons matter and they are not the same event:
 *
 *   subscription_create  the first payment. Assign the plan, minutes to zero.
 *   subscription_cycle   the monthly renewal. Minutes to zero.
 *   subscription_update  a proration from switching plans mid-month. Real
 *                        money, so it is recorded — but it is not a new month,
 *                        so minutes are left exactly where they are.
 *
 * Getting that last one wrong would mean a tenant could reset their minutes by
 * switching plan and switching back.
 */
async function settleInvoice(invoice: Stripe.Invoice) {
  const reason = invoice.billing_reason
  if (
    reason !== "subscription_create" &&
    reason !== "subscription_cycle" &&
    reason !== "subscription_update"
  ) return

  if (!invoice.id) return

  const meta = invoiceMetadata(invoice)
  const subscriptionId = subscriptionIdOf(invoice)

  const tenantId = await resolveTenantId({
    metadataTenantId: meta.tenantId,
    subscriptionId,
    customerId:       customerIdOf(invoice.customer),
  })
  if (!tenantId) return

  // Already settled. The unique index is the real guard — this is just the
  // cheap check that avoids doing the work twice in the common case.
  const already = await prisma.payment.findUnique({
    where:  { stripeInvoiceId: invoice.id },
    select: { id: true },
  })
  if (already) return

  const amountCents = invoice.amount_paid ?? 0

  /*
   * Read the subscription rather than trusting the invoice's metadata snapshot
   * for *which plan*. The snapshot is frozen at finalisation and is correct
   * about who; the live subscription is correct about what they are on now,
   * which is what decides the allowance.
   */
  const stripe = getStripe()
  let sub: Stripe.Subscription | null = null
  if (subscriptionId) {
    try {
      sub = await stripe.subscriptions.retrieve(subscriptionId)
    } catch (error) {
      console.error("[webhooks/stripe/retrieveSubscription]", error)
    }
  }

  const pkg =
    (await packageForPrice(sub ? priceIdOf(sub) : null)) ??
    (meta.packageId
      ? await prisma.package.findUnique({
          where:  { id: meta.packageId },
          select: {
            id: true, name: true, minutesIncluded: true,
            priceCents: true, overageRateCents: true,
          },
        })
      : null)

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, companyName: true, packageId: true },
  })
  if (!tenant) return

  const startsNewPeriod = reason === "subscription_create" || reason === "subscription_cycle"

  /*
   * The payment intent is not on the invoice any more, and it is the only thing
   * that will link a later refund back to this row. Worth one extra call.
   *
   * It is dropped if some other payment already claims it. One intent can
   * settle more than one invoice — uncommon, but Stripe allows it — and the
   * column is unique, so keeping it would make this insert fail. That failure
   * looks exactly like a replayed webhook, so it would be swallowed as
   * "already handled" and the customer's minutes would silently never reset
   * for a month they had paid for. The invoice id is the real key here; the
   * intent is a convenience, and a convenience does not get to break billing.
   */
  let intentId = await paymentIntentOf(invoice.id)
  if (intentId) {
    const claimed = await prisma.payment.findUnique({
      where:  { stripePaymentIntentId: intentId },
      select: { id: true },
    })
    if (claimed) intentId = null
  }

  try {
    await prisma.$transaction([
      prisma.payment.create({
        data: {
          tenantId,
          stripeInvoiceId:       invoice.id,
          stripePaymentIntentId: intentId,
          amountCents,
          type:   "SUBSCRIPTION",
          status: "COMPLETED",
        },
      }),
      prisma.tenant.update({
        where: { id: tenantId },
        data: {
          ...(pkg ? { packageId: pkg.id, packageAssignedAt: new Date() } : {}),
          ...(startsNewPeriod ? { minutesUsed: 0 } : {}),
          ...(sub ? tenantFieldsFrom(sub) : {}),
        },
      }),
      // Not a credit movement, so the amount is zero — but a tenant should be
      // able to see in one place that their allowance came back.
      prisma.creditLedger.create({
        data: {
          tenantId,
          type:        "MANUAL_CREDIT",
          amountCents: 0,
          description: pkg
            ? startsNewPeriod
              ? `${pkg.name} plan — ${pkg.minutesIncluded.toLocaleString()} minutes available`
              : `${pkg.name} plan — changed mid-month`
            : "Plan payment received",
        },
      }),
    ])
  } catch (error) {
    // Another delivery of the same event got there first.
    if (isUniqueViolation(error)) return
    throw error
  }

  // A fresh allowance is reason enough to bring paused agents back, whatever
  // the balance says.
  if (startsNewPeriod) {
    const paused = await prisma.agent.findMany({
      where:  { tenantId, status: "INACTIVE" },
      select: { id: true, vapiAssistantId: true },
    })
    if (paused.length) await enableAllTenantAgents(tenantId, paused)
  }

  const recipients = await billingRecipients(tenantId)
  if (!recipients.length || !pkg) return

  if (reason === "subscription_create") {
    await sendPackageActivated({
      to: recipients,
      companyName:      tenant.companyName,
      packageName:      pkg.name,
      minutesIncluded:  pkg.minutesIncluded,
      overageRateCents: pkg.overageRateCents,
      amountCents,
    })
  } else if (reason === "subscription_cycle") {
    await sendPlanRenewed({
      to: recipients,
      companyName:     tenant.companyName,
      packageName:     pkg.name,
      minutesIncluded: pkg.minutesIncluded,
      amountCents,
      renewsOn:        sub ? periodEndOf(sub) : null,
    })
  }
}

/**
 * A renewal did not go through.
 *
 * Nothing is taken away here. Stripe retries a failed card for days before
 * giving up, and cutting a business off on the first decline — over a card that
 * expired — would be both wrong and the thing they tell people about. When
 * Stripe does give up it says so, as `canceled` or `unpaid`, and that is what
 * ends the plan.
 */
async function noteFailedInvoice(invoice: Stripe.Invoice) {
  const meta = invoiceMetadata(invoice)
  const subscriptionId = subscriptionIdOf(invoice)

  const tenantId = await resolveTenantId({
    metadataTenantId: meta.tenantId,
    subscriptionId,
    customerId:       customerIdOf(invoice.customer),
  })
  if (!tenantId) return

  const tenant = await prisma.tenant.update({
    where:  { id: tenantId },
    data:   { subscriptionStatus: "PAST_DUE" },
    select: { companyName: true },
  })

  const recipients = await billingRecipients(tenantId)
  if (recipients.length) {
    await sendPaymentFailed({
      to: recipients,
      companyName: tenant.companyName,
      amountCents: invoice.amount_due ?? 0,
    })
  }
}

/* ═══ Checkout ══════════════════════════════════════════════════════════ */

/**
 * Checkout finished.
 *
 * Two modes reach here. A subscription checkout is settled by `invoice.paid`,
 * and all this does is link the subscription immediately so the page the
 * customer lands back on is already correct rather than correct a second later.
 * A setup checkout is a card being replaced, and this is where the new card
 * becomes the one future renewals are taken from — attaching it to the customer
 * without also pointing the subscription at it is the classic version of this
 * bug, where the customer updates their card and the next renewal still fails.
 */
async function finishCheckout(session: Stripe.Checkout.Session) {
  const stripe = getStripe()

  if (session.mode === "subscription") {
    const subscriptionId = idOf(session.subscription as string | Stripe.Subscription | null)
    if (!subscriptionId) return

    const tenantId = await resolveTenantId({
      metadataTenantId: session.metadata?.tenantId,
      subscriptionId,
      customerId:       customerIdOf(session.customer),
    })
    if (!tenantId) return

    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    const pkg = await packageForPrice(priceIdOf(sub))

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...tenantFieldsFrom(sub),
        ...(pkg ? { packageId: pkg.id } : {}),
      },
    })
    return
  }

  if (session.mode === "setup") {
    const setupIntentId = idOf(session.setup_intent as string | Stripe.SetupIntent | null)
    const customerId = customerIdOf(session.customer)
    if (!setupIntentId || !customerId) return

    const intent = await stripe.setupIntents.retrieve(setupIntentId)
    const paymentMethodId = idOf(intent.payment_method as string | Stripe.PaymentMethod | null)
    if (!paymentMethodId) return

    // Default for anything invoiced in future.
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    })

    // And for the subscription specifically, which keeps its own default and
    // would otherwise carry on trying the card that just failed.
    const tenant = await prisma.tenant.findFirst({
      where:  { stripeCustomerId: customerId },
      select: { stripeSubscriptionId: true },
    })
    if (tenant?.stripeSubscriptionId) {
      await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
        default_payment_method: paymentMethodId,
      })
    }
  }
}

/* ═══ Money going back ══════════════════════════════════════════════════ */

/**
 * A refund, whole or partial.
 *
 * Stripe sends the *total* refunded on the charge every time, not the amount of
 * this particular refund, so the difference against what we have already
 * clawed back is what to act on. That is also what makes a replay a no-op: the
 * second delivery computes a difference of zero.
 *
 * Only a top-up moves the balance. Refunding a plan payment gives money back
 * for minutes, and minutes are not credit — taking credit away for it would
 * charge them twice for one refund.
 *
 * The balance is floored at zero. A tenant who spent their credit and then got
 * a refund would otherwise be left owing us money through a column that was
 * never designed to be negative, and every "can they call" check downstream
 * treats negative as simply zero anyway.
 */
async function applyRefund(charge: Stripe.Charge) {
  const intentId = idOf(charge.payment_intent as string | Stripe.PaymentIntent | null)
  if (!intentId) return

  const payment = await prisma.payment.findUnique({
    where:  { stripePaymentIntentId: intentId },
    select: { id: true, tenantId: true, type: true, amountCents: true, refundedCents: true },
  })
  if (!payment) return

  const totalRefunded = Math.min(charge.amount_refunded ?? 0, payment.amountCents)
  const delta = totalRefunded - payment.refundedCents
  if (delta <= 0) return

  const tenant = await prisma.tenant.findUnique({
    where:  { id: payment.tenantId },
    select: { companyName: true, creditBalanceCents: true },
  })
  if (!tenant) return

  const creditRemoved =
    payment.type === "TOP_UP" ? Math.min(delta, Math.max(0, tenant.creditBalanceCents)) : 0

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedCents: totalRefunded,
        // Partial refunds stay COMPLETED: most of that payment is still paid,
        // and calling the whole row "refunded" would misread the history.
        status: totalRefunded >= payment.amountCents ? "REFUNDED" : "COMPLETED",
      },
    }),
    prisma.tenant.update({
      where: { id: payment.tenantId },
      data:  { creditBalanceCents: { decrement: creditRemoved } },
    }),
    prisma.creditLedger.create({
      data: {
        tenantId:    payment.tenantId,
        type:        "REFUND",
        amountCents: -creditRemoved,
        description:
          payment.type === "TOP_UP"
            ? "Credit reversed — payment refunded"
            : "Plan payment refunded",
      },
    }),
  ])

  const recipients = await billingRecipients(payment.tenantId)
  if (recipients.length) {
    await sendRefundProcessed({
      to: recipients,
      companyName:        tenant.companyName,
      amountCents:        delta,
      creditRemovedCents: creditRemoved,
      balanceCents:       tenant.creditBalanceCents - creditRemoved,
    })
  }
}

/**
 * A chargeback.
 *
 * Everything the refund path does, plus the workspace stops.
 *
 * That is deliberate and it is not a punishment. A dispute means the money is
 * already gone, we have been charged a fee on top, and the account is either
 * compromised or being used by someone who does not intend to pay. Every minute
 * it keeps dialling costs real money on a provider bill nobody is going to
 * settle. Suspension is reversible by a person in the admin area once they know
 * which of those it is; an unbounded spend is not.
 *
 * No email. The cardholder has already spoken to their bank, and a cheerful
 * note from us at this point is not the right move — an operator picks this up.
 */
async function applyDispute(dispute: Stripe.Dispute) {
  const intentId = idOf(dispute.payment_intent as string | Stripe.PaymentIntent | null)

  const payment = intentId
    ? await prisma.payment.findUnique({
        where:  { stripePaymentIntentId: intentId },
        select: { id: true, tenantId: true, type: true, amountCents: true, refundedCents: true },
      })
    : null

  /*
   * A dispute carries a charge and an intent, and no customer. When the intent
   * does not match a payment row we know about — a charge made outside this
   * platform, or one whose row was never written — the charge itself is the
   * only route to the customer, and from there to the workspace. Worth the
   * extra call: this is the one event where failing to find the tenant means
   * leaving a compromised account dialling.
   */
  let tenantId = payment?.tenantId ?? null
  if (!tenantId) {
    const chargeId = idOf(dispute.charge as string | Stripe.Charge | null)
    if (chargeId) {
      try {
        const charge = await getStripe().charges.retrieve(chargeId)
        tenantId = await resolveTenantId({ customerId: customerIdOf(charge.customer) })
      } catch (error) {
        console.error("[webhooks/stripe/disputeCharge]", error)
      }
    }
  }
  if (!tenantId) return

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { creditBalanceCents: true },
  })
  if (!tenant) return

  const disputed = payment
    ? Math.min(dispute.amount ?? 0, payment.amountCents)
    : (dispute.amount ?? 0)
  const creditRemoved =
    payment?.type === "TOP_UP"
      ? Math.min(Math.max(0, disputed - payment.refundedCents), Math.max(0, tenant.creditBalanceCents))
      : 0

  await prisma.$transaction([
    ...(payment
      ? [
          prisma.payment.update({
            where: { id: payment.id },
            data:  { status: "DISPUTED", refundedCents: Math.max(payment.refundedCents, disputed) },
          }),
        ]
      : []),
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        creditBalanceCents: { decrement: creditRemoved },
        // Suspended, not blocked. An operator turns this back on once they know
        // whether it was fraud or a confused customer.
        status: "INACTIVE",
      },
    }),
    prisma.creditLedger.create({
      data: {
        tenantId,
        type:        "CHARGEBACK",
        amountCents: -creditRemoved,
        description: "Payment disputed with the cardholder's bank",
      },
    }),
  ])

  const agents = await prisma.agent.findMany({
    where:  { tenantId },
    select: { id: true, vapiAssistantId: true },
  })
  await disableAllTenantAgents(tenantId, agents)
  await pauseTenantCampaigns(tenantId)
}

/* ═══ Top-ups ═══════════════════════════════════════════════════════════ */

async function creditTenant({
  tenantId,
  intentId,
  amountCents,
}: {
  tenantId: string
  intentId: string
  amountCents: number
}) {
  if (amountCents <= 0) return

  // Already settled — a replayed event must not double-credit.
  const existing = await prisma.payment.findUnique({
    where:  { stripePaymentIntentId: intentId },
    select: { id: true, status: true },
  })
  if (existing?.status === "COMPLETED") return

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, creditBalanceCents: true },
  })
  if (!tenant) return

  const wasEmpty = tenant.creditBalanceCents <= 0

  try {
    await prisma.$transaction([
      existing
        ? prisma.payment.update({
            where: { id: existing.id },
            data:  { status: "COMPLETED", amountCents },
          })
        : prisma.payment.create({
            data: {
              tenantId,
              stripePaymentIntentId: intentId,
              amountCents,
              type:   "TOP_UP",
              status: "COMPLETED",
            },
          }),
      prisma.tenant.update({
        where: { id: tenantId },
        data:  { creditBalanceCents: { increment: amountCents } },
      }),
      prisma.creditLedger.create({
        data: {
          tenantId,
          type:        "TOP_UP",
          amountCents,
          description: "Credit top-up",
        },
      }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) return
    throw error
  }

  // Bring paused agents back online now that there is balance again.
  let resumed = false
  if (wasEmpty) {
    const agents = await prisma.agent.findMany({
      where:  { tenantId, status: "INACTIVE" },
      select: { id: true, vapiAssistantId: true },
    })
    if (agents.length) {
      await enableAllTenantAgents(tenantId, agents)
      resumed = true
    }
  }

  const after = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { companyName: true, creditBalanceCents: true },
  })
  const recipients = await billingRecipients(tenantId)

  if (after && recipients.length) {
    await sendTopUpConfirmed({
      to: recipients,
      companyName:  after.companyName,
      amountCents,
      balanceCents: after.creditBalanceCents,
      resumed,
    })
  }
}

/**
 * The old one-off plan purchase, settling late.
 *
 * Plans are subscriptions now and nothing creates one of these any more, but an
 * intent created minutes before the deploy can still succeed minutes after it,
 * and dropping that on the floor would take someone's money and give them
 * nothing.
 */
async function settleLegacyPackage({
  tenantId,
  packageId,
  intentId,
  amountCents,
}: {
  tenantId: string
  packageId: string
  intentId: string
  amountCents: number
}) {
  if (amountCents <= 0) return

  const existing = await prisma.payment.findUnique({
    where:  { stripePaymentIntentId: intentId },
    select: { id: true, status: true },
  })
  if (existing?.status === "COMPLETED") return

  const [tenant, pkg] = await Promise.all([
    prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { id: true, companyName: true },
    }),
    prisma.package.findUnique({
      where:  { id: packageId },
      select: { id: true, name: true, minutesIncluded: true, overageRateCents: true },
    }),
  ])

  if (!tenant) return
  // Paid for something since deleted. Give credit rather than keep the money
  // and hand over nothing.
  if (!pkg) {
    await creditTenant({ tenantId, intentId, amountCents })
    return
  }

  try {
    await prisma.$transaction([
      existing
        ? prisma.payment.update({
            where: { id: existing.id },
            data:  { status: "COMPLETED", amountCents, type: "PACKAGE_PURCHASE" },
          })
        : prisma.payment.create({
            data: {
              tenantId,
              stripePaymentIntentId: intentId,
              amountCents,
              type:   "PACKAGE_PURCHASE",
              status: "COMPLETED",
            },
          }),
      prisma.tenant.update({
        where: { id: tenantId },
        data:  { packageId: pkg.id, packageAssignedAt: new Date(), minutesUsed: 0 },
      }),
      prisma.creditLedger.create({
        data: {
          tenantId,
          type:        "MANUAL_CREDIT",
          amountCents: 0,
          description: `${pkg.name} plan activated — ${pkg.minutesIncluded.toLocaleString()} minutes included`,
        },
      }),
    ])
  } catch (error) {
    if (isUniqueViolation(error)) return
    throw error
  }

  const paused = await prisma.agent.findMany({
    where:  { tenantId, status: "INACTIVE" },
    select: { id: true, vapiAssistantId: true },
  })
  if (paused.length) await enableAllTenantAgents(tenantId, paused)

  const recipients = await billingRecipients(tenantId)
  if (recipients.length) {
    await sendPackageActivated({
      to: recipients,
      companyName:      tenant.companyName,
      packageName:      pkg.name,
      minutesIncluded:  pkg.minutesIncluded,
      overageRateCents: pkg.overageRateCents,
      amountCents,
    })
  }
}
