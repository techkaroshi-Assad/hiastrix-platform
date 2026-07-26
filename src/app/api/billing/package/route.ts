/**
 * POST /api/billing/package — buy or switch a package.
 *
 * A package purchase is a plain one-off charge, not a subscription: it buys a
 * block of minutes, and the tenant comes back when they want more. The package
 * is not assigned here — only the webhook, after money has actually moved, does
 * that. Assigning on redirect would hand out an allowance to anyone who reached
 * the success URL.
 *
 * The credit balance is deliberately untouched by this. Included minutes cost
 * nothing to use; credit exists to pay for anything beyond them. Crediting the
 * price as well would hand over the same minutes twice.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { getStripe, stripeConfigured } from "@/lib/stripe"
import { minutesLabel } from "@/lib/billing/allowance"
import { usd } from "@/lib/format"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const BodySchema = z.object({ packageId: z.string().uuid() })

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    if (!stripeConfigured()) {
      return apiError("Payments aren't available right now. Please contact support.", 503)
    }
    if (ctx.tenant.status === "BLOCKED" || ctx.tenant.status === "INACTIVE") {
      return apiError("This workspace can't make purchases right now. Please contact support.", 403)
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Choose a plan and try again.")

    // Only active packages are purchasable — one retired mid-checkout should not
    // still be sellable from a stale page.
    const pkg = await prisma.package.findFirst({
      where:  { id: parsed.data.packageId, isActive: true },
      select: { id: true, name: true, priceCents: true, minutesIncluded: true, overageRateCents: true },
    })
    if (!pkg) return apiError("That plan is no longer available.", 404)
    if (pkg.priceCents <= 0) {
      return apiError("That plan can't be bought online. Please contact support.")
    }

    const appUrl = process.env.APP_URL ?? "https://app.hiastrix.com"
    const stripe = getStripe()

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
            unit_amount: pkg.priceCents,
            product_data: {
              name: `${pkg.name} plan`,
              // What they are buying, in the unit they think in.
              description: `${minutesLabel(pkg.minutesIncluded)} included, then ${usd(pkg.overageRateCents)} per minute.`,
            },
          },
        },
      ],
      success_url: `${appUrl}/dashboard/billing?plan=success`,
      cancel_url:  `${appUrl}/dashboard/billing?plan=cancelled`,
      metadata: {
        tenantId:  ctx.tenant.id,
        packageId: pkg.id,
      },
      // The webhook settles from the payment intent, so the routing metadata has
      // to be on the intent as well as the session.
      payment_intent_data: {
        metadata: {
          tenantId:  ctx.tenant.id,
          packageId: pkg.id,
        },
      },
    })

    if (!session.url) return apiError(ERRORS.FALLBACK)
    return Response.json({ url: session.url })
  } catch (error) {
    return apiError(sanitiseError(error, "billing/package"))
  }
}
