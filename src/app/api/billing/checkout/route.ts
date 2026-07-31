/**
 * POST /api/billing/checkout — start a Stripe Checkout session for a top-up.
 *
 * We create the Payment row as PENDING up front and pass its id through as
 * checkout metadata, so the webhook can settle the exact row it belongs to
 * rather than guessing from an amount.
 *
 * The response contains only a redirect URL. No key, customer id, or provider
 * error string is ever returned to the browser.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import {
  getStripe,
  stripeConfigured,
  MIN_TOPUP_CENTS,
  MAX_TOPUP_CENTS,
} from "@/lib/stripe"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({
  amountCents: z.number().int().min(MIN_TOPUP_CENTS).max(MAX_TOPUP_CENTS),
})

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (!stripeConfigured()) {
      return apiError("Payments aren't available right now. Please contact support.", 503)
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(
        `Enter an amount between $${MIN_TOPUP_CENTS / 100} and $${(MAX_TOPUP_CENTS / 100).toLocaleString()}.`
      )
    }

    const { amountCents } = parsed.data
    const appUrl = process.env.APP_URL ?? "https://app.hiastrix.com"
    const stripe = getStripe()

    // Reuse the tenant's customer record so payment methods and history stay
    // together across top-ups.
    let customerId = ctx.tenant.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: ctx.tenant.email,
        name:  ctx.tenant.companyName,
        metadata: { tenantId: ctx.tenant.id },
      })
      customerId = customer.id
      await prisma.tenant.update({
        where: { id: ctx.tenant.id },
        data:  { stripeCustomerId: customerId },
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: "Hi-Astrix calling credit",
              description: "Credit applied to your workspace balance.",
            },
          },
        },
      ],
      success_url: `${appUrl}/dashboard/billing?topup=success`,
      cancel_url:  `${appUrl}/dashboard/billing?topup=cancelled`,
      metadata: {
        tenantId: ctx.tenant.id,
      },
      /*
       * `tenantId` on the intent is what tells the webhook this charge is a
       * top-up and not a plan renewal. Subscription charges arrive on the same
       * `payment_intent.succeeded` event carrying no metadata of ours, and
       * without this marker the webhook would have no way to tell the two
       * apart — which would mean crediting every monthly plan payment to the
       * balance as if it were a top-up.
       */
      payment_intent_data: {
        metadata: { tenantId: ctx.tenant.id, kind: "topup" },
      },
    })

    if (!session.url) return apiError(ERRORS.FALLBACK)

    return Response.json({ url: session.url })
  } catch (error) {
    return apiError(sanitiseError(error, "billing/checkout"))
  }
}
