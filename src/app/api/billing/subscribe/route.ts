/**
 * POST /api/billing/subscribe — start or change a monthly plan.
 *
 * One endpoint, two paths, decided by whether there is already a live
 * subscription:
 *
 *   No subscription  → a Checkout session in subscription mode. Stripe collects
 *                      the card, takes the first payment, and creates the
 *                      subscription. We do nothing until the webhook says the
 *                      money moved.
 *
 *   Live subscription → a plan switch, applied directly against the Stripe API
 *                      with proration. No checkout, no card re-entry, no
 *                      leaving the app for a payment they have already
 *                      authorised.
 *
 * Nothing here assigns a package. Reaching a success URL is not evidence that
 * anybody paid, and neither is an API call returning 200 — a proration invoice
 * can still fail. `invoice.paid` is the only thing that grants an allowance.
 *
 * The response is a URL or a plain acknowledgement. No key, customer id,
 * subscription id or provider error string ever reaches the browser.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { getStripe, stripeConfigured } from "@/lib/stripe"
import { syncPackagePrice, subscriptionIsLive } from "@/lib/billing/subscription"
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
      return apiError("This workspace can't change its plan right now. Please contact support.", 403)
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError("Choose a plan and try again.")

    // Only active plans are purchasable. One retired mid-checkout should not
    // still be sellable from a page loaded ten minutes ago.
    const pkg = await prisma.package.findFirst({
      where:  { id: parsed.data.packageId, isActive: true },
      select: {
        id: true, name: true, priceCents: true, minutesIncluded: true,
        overageRateCents: true, stripeProductId: true, stripePriceId: true,
      },
    })
    if (!pkg) return apiError("That plan is no longer available.", 404)
    if (pkg.priceCents <= 0) {
      return apiError("That plan can't be bought online. Please contact support.")
    }

    const stripe = getStripe()
    const appUrl = process.env.APP_URL ?? "https://app.hiastrix.com"

    // Stripe needs a monthly price for this plan before anyone can subscribe to
    // it. Created on demand and cached, so this is one API call the first time
    // a plan is ever bought and none after that.
    const priceId = await syncPackagePrice(pkg)

    /* ── Already subscribed: switch, don't sell again ───────────────────── */

    if (
      ctx.tenant.stripeSubscriptionId &&
      subscriptionIsLive(ctx.tenant.subscriptionStatus)
    ) {
      const current = await stripe.subscriptions.retrieve(ctx.tenant.stripeSubscriptionId)
      const item = current.items.data[0]

      if (!item) return apiError(ERRORS.FALLBACK)

      const itemPriceId = typeof item.price === "string" ? item.price : item.price?.id
      if (itemPriceId === priceId && !current.cancel_at_period_end) {
        return apiError("You're already on that plan.")
      }

      await stripe.subscriptions.update(ctx.tenant.stripeSubscriptionId, {
        items: [{ id: item.id, price: priceId }],
        // Charge or credit the difference for the rest of this month, rather
        // than letting an upgrade ride free until the next renewal or a
        // downgrade keep charging the old rate.
        proration_behavior: "create_prorations",
        // Switching plans is also the obvious way to change your mind about
        // cancelling, so it clears a pending cancellation.
        cancel_at_period_end: false,
        metadata: { tenantId: ctx.tenant.id, packageId: pkg.id },
      })

      // The webhook applies the change. Returning it here as well would mean
      // two writers for one fact, and the one that loses is whichever arrives
      // second — which under a retry is not predictable.
      return Response.json({ switched: true })
    }

    /* ── Not subscribed: checkout ───────────────────────────────────────── */

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
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard/billing?plan=success`,
      cancel_url:  `${appUrl}/dashboard/billing?plan=cancelled`,
      metadata: { tenantId: ctx.tenant.id, packageId: pkg.id },
      // Copied onto the subscription, and from there frozen into every invoice
      // it ever generates. That snapshot is how a renewal thirteen months from
      // now still knows which workspace it belongs to without a lookup.
      subscription_data: {
        metadata: { tenantId: ctx.tenant.id, packageId: pkg.id },
      },
    })

    if (!session.url) return apiError(ERRORS.FALLBACK)
    return Response.json({ url: session.url })
  } catch (error) {
    return apiError(sanitiseError(error, "billing/subscribe"))
  }
}
