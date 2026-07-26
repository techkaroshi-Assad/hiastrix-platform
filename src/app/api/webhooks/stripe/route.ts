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
        await creditTenant({
          tenantId:    pi.metadata?.tenantId,
          intentId:    pi.id,
          amountCents: pi.amount_received || pi.amount,
        })
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
  if (wasEmpty) {
    const agents = await prisma.agent.findMany({
      where:  { tenantId, status: "INACTIVE" },
      select: { id: true, vapiAssistantId: true },
    })
    if (agents.length) await enableAllTenantAgents(tenantId, agents)
  }
}
