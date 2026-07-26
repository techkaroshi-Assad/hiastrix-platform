/**
 * POST /api/webhooks/stripe — payment settlement.
 *
 * The raw request body is required for signature verification, so this route
 * reads text() and never json(). An unverified request is rejected outright.
 *
 * Idempotent by construction: the Payment row is keyed on the unique
 * stripePaymentIntentId, so a replayed event finds an existing COMPLETED row
 * and does nothing.
 */

import { NextRequest } from "next/server"
import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"
import { enableAllTenantAgents } from "@/lib/billing/cap-enforcement"
import { sendTopUpConfirmed, sendPackageActivated, billingRecipients } from "@/lib/email"

export const dynamic = "force-dynamic"

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
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent
        // Two kinds of payment arrive here. A package purchase carries a
        // packageId; a top-up does not.
        if (pi.metadata?.packageId) {
          await assignPackage({
            tenantId:    pi.metadata?.tenantId,
            packageId:   pi.metadata.packageId,
            intentId:    pi.id,
            amountCents: pi.amount_received || pi.amount,
          })
        } else {
          await creditTenant({
            tenantId:    pi.metadata?.tenantId,
            intentId:    pi.id,
            amountCents: pi.amount_received || pi.amount,
          })
        }
        break
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent
        await prisma.payment.updateMany({
          where: { stripePaymentIntentId: pi.id },
          data:  { status: "FAILED" },
        })
        break
      }

      default:
        break
    }

    return Response.json({ received: true })
  } catch (error) {
    console.error("[webhooks/stripe]", error)
    return new Response(null, { status: 500 })
  }
}

async function creditTenant({
  tenantId,
  intentId,
  amountCents,
}: {
  tenantId?: string
  intentId: string
  amountCents: number
}) {
  if (!tenantId || amountCents <= 0) return

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
 * Settle a package purchase.
 *
 * Assigned here rather than on the success redirect, because a redirect only
 * proves someone reached a URL. Money moving is the only evidence that should
 * grant an allowance.
 *
 * Resets `minutesUsed`, which is what makes this a new period: buying the same
 * package again is how a tenant renews, and buying a different one is how they
 * switch. The credit balance is untouched — included minutes cost nothing to
 * use, and crediting the price as well would give the same minutes away twice.
 */
async function assignPackage({
  tenantId,
  packageId,
  intentId,
  amountCents,
}: {
  tenantId?: string
  packageId: string
  intentId: string
  amountCents: number
}) {
  if (!tenantId || amountCents <= 0) return

  const existing = await prisma.payment.findUnique({
    where:  { stripePaymentIntentId: intentId },
    select: { id: true, status: true },
  })
  if (existing?.status === "COMPLETED") return

  const [tenant, pkg] = await Promise.all([
    prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { id: true, companyName: true, minutesUsed: true },
    }),
    prisma.package.findUnique({
      where:  { id: packageId },
      select: { id: true, name: true, minutesIncluded: true, overageRateCents: true },
    }),
  ])

  // Paid for something that has since been deleted. Fall back to plain credit
  // rather than silently keeping their money and giving nothing back.
  if (!tenant) return
  if (!pkg) {
    await creditTenant({ tenantId, intentId, amountCents })
    return
  }

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
      data: {
        packageId:         pkg.id,
        packageAssignedAt: new Date(),
        minutesUsed:       0,
      },
    }),
    // Not a credit movement, so amountCents is zero — but the tenant should be
    // able to see in one place that their allowance was renewed.
    prisma.creditLedger.create({
      data: {
        tenantId,
        type:        "MANUAL_CREDIT",
        amountCents: 0,
        description: `${pkg.name} plan activated — ${pkg.minutesIncluded.toLocaleString()} minutes included`,
      },
    }),
  ])

  // A fresh allowance is reason enough to bring paused agents back, whatever the
  // balance says.
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
