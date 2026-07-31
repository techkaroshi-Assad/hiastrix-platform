/**
 * POST /api/billing/subscription — cancel, resume, or replace the card.
 *
 * Deliberately not Stripe's hosted billing portal. The portal is one link and
 * would have saved a day, but it is a Stripe-branded page listing Stripe's idea
 * of the plans, and this platform is white-label: a tenant should never be
 * handed to a third party's interface to manage something they bought from us.
 * Cancel and resume are two API calls; the only thing genuinely worth handing
 * over is card entry, and that goes through the same Checkout page they already
 * used to pay, not a portal.
 *
 * Cancelling never takes minutes away. `cancel_at_period_end` means the plan
 * runs to the end of the month already paid for. Cancelling mid-month and
 * losing the allowance you just bought is the kind of thing people remember.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { getStripe, stripeConfigured } from "@/lib/stripe"
import { tenantFieldsFrom, subscriptionIsLive } from "@/lib/billing/subscription"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  action: z.enum(["cancel", "resume", "update_card"]),
})

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (!stripeConfigured()) {
      return apiError("Payments aren't available right now. Please contact support.", 503)
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(ERRORS.FALLBACK)

    const { tenant } = ctx
    const stripe = getStripe()

    /* ── Replace the card ───────────────────────────────────────────────── */

    if (parsed.data.action === "update_card") {
      if (!tenant.stripeCustomerId) {
        return apiError("There's no payment method on file yet. Choose a plan or add credit first.")
      }

      const appUrl = process.env.APP_URL ?? "https://app.hiastrix.com"
      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: tenant.stripeCustomerId,
        success_url: `${appUrl}/dashboard/billing?card=success`,
        cancel_url:  `${appUrl}/dashboard/billing?card=cancelled`,
        metadata: { tenantId: tenant.id },
      })

      if (!session.url) return apiError(ERRORS.FALLBACK)
      return Response.json({ url: session.url })
    }

    /* ── Cancel and resume ──────────────────────────────────────────────── */

    if (!tenant.stripeSubscriptionId || !subscriptionIsLive(tenant.subscriptionStatus)) {
      return apiError("There's no active plan to change.")
    }

    const cancelling = parsed.data.action === "cancel"

    const sub = await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
      cancel_at_period_end: cancelling,
    })

    /*
     * Written here as well as in the webhook, on purpose.
     *
     * This is the one place where the person who made the change is sitting in
     * front of the page waiting to see it, and `customer.subscription.updated`
     * usually arrives a second or two later. Applying it now means the page
     * they land back on is already right. The webhook writes the same fields
     * from the same source of truth, so whichever lands second is a no-op
     * rather than a conflict.
     */
    await prisma.tenant.update({
      where: { id: tenant.id },
      data:  tenantFieldsFrom(sub),
    })

    return Response.json({
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    })
  } catch (error) {
    return apiError(sanitiseError(error, "billing/subscription"))
  }
}
