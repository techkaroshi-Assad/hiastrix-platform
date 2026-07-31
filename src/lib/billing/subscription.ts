/**
 * Plans as monthly subscriptions.
 *
 * A plan used to be bought outright — one charge, minutes reset, come back next
 * time. It is now a subscription Stripe renews every month, which changes one
 * thing fundamentally: the moment a tenant's allowance starts again is decided
 * by whether a payment cleared, not by anyone pressing a button. Everything in
 * this file exists to make that single fact reliable.
 *
 * Three rules the rest of the billing code depends on:
 *
 *   1. A price in Stripe is immutable. Editing a plan's price in the admin area
 *      cannot change a Stripe price that subscribers are already on — it makes
 *      a new one. Existing subscribers keep paying what they agreed to until
 *      they switch, which is both the honest behaviour and the only one Stripe
 *      allows.
 *
 *   2. The subscription is *how the plan is paid for*, never *whether there is
 *      a plan*. An operator can grant a package with no subscription behind it,
 *      and that tenant must keep working. Nothing here may read
 *      `stripeSubscriptionId == null` as "no allowance".
 *
 *   3. The Stripe API version in use (2026-06-24.dahlia) no longer carries
 *      `current_period_end` on the subscription — it lives on each subscription
 *      item — and no longer carries `subscription` or `payment_intent` on the
 *      invoice. Reading those off the top-level object returns undefined at
 *      runtime while typechecking fine against `any`, so every access goes
 *      through the readers below rather than being written out by hand.
 */

import type Stripe from "stripe"
import type { SubscriptionStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getStripe } from "@/lib/stripe"
import { minutesLabel } from "@/lib/billing/allowance"
import { usd } from "@/lib/format"

/* ─── Status ──────────────────────────────────────────────────────────────── */

/**
 * Stripe's states, mirrored rather than reinterpreted.
 *
 * Collapsing these to a boolean loses the distinction that matters most:
 * `past_due` is a card that failed and is still being retried — the customer
 * has their allowance and needs telling — while `canceled` is over.
 */
const STATUS: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  trialing:            "TRIALING",
  active:              "ACTIVE",
  past_due:            "PAST_DUE",
  canceled:            "CANCELED",
  incomplete:          "INCOMPLETE",
  incomplete_expired:  "INCOMPLETE_EXPIRED",
  unpaid:              "UNPAID",
  paused:              "PAUSED",
}

export function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  return STATUS[s] ?? "INCOMPLETE"
}

/** States in which the allowance should still be honoured. */
const LIVE: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE"]

/**
 * `past_due` deliberately counts as live.
 *
 * Stripe retries a failed renewal for days before giving up. Cutting a customer
 * off on the first failed attempt would take a working business off the air
 * over a card that expired, and Stripe will tell us plainly when it has
 * actually given up — that arrives as `canceled` or `unpaid`, and only then
 * does the allowance end.
 */
export function subscriptionIsLive(status: SubscriptionStatus | null): boolean {
  return status !== null && LIVE.includes(status)
}

/* ─── Reading a subscription ──────────────────────────────────────────────── */

/**
 * End of the period already paid for.
 *
 * Moved onto the subscription *items* in the current API version, because
 * different items on one subscription can bill on different cycles. Ours never
 * do — one plan, one item — but the field has to be read from where it now
 * lives. The latest of the items is the safe reading if that ever changes.
 */
export function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = (sub.items?.data ?? [])
    .map(i => i.current_period_end)
    .filter((n): n is number => typeof n === "number" && n > 0)

  if (ends.length === 0) return null
  return new Date(Math.max(...ends) * 1000)
}

/** The price the subscription is on, which is how we find the plan it means. */
export function priceIdOf(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0]
  const price = item?.price
  if (!price) return null
  return typeof price === "string" ? price : price.id
}

/** Everything a subscription tells us about a tenant, in one object. */
export function tenantFieldsFrom(sub: Stripe.Subscription) {
  return {
    stripeSubscriptionId: sub.id,
    subscriptionStatus:   mapStatus(sub.status),
    currentPeriodEnd:     periodEndOf(sub),
    cancelAtPeriodEnd:    Boolean(sub.cancel_at_period_end),
  }
}

/* ─── Reading an invoice ──────────────────────────────────────────────────── */

/**
 * The subscription an invoice belongs to.
 *
 * `invoice.subscription` was removed; it now sits under `parent`, alongside a
 * frozen snapshot of the subscription's metadata taken when the invoice was
 * finalised. That snapshot is how we find the tenant without a database lookup,
 * and it is the reason `subscription_data.metadata` is set at checkout.
 */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const details = invoice.parent?.subscription_details
  const sub = details?.subscription
  if (!sub) return null
  return typeof sub === "string" ? sub : sub.id
}

export function invoiceMetadata(invoice: Stripe.Invoice): Record<string, string> {
  return (invoice.parent?.subscription_details?.metadata ?? {}) as Record<string, string>
}

/**
 * The payment intent that settled an invoice.
 *
 * Not on the invoice object any more, and worth one extra API call to find,
 * because it is the only thing that links a later `charge.refunded` back to the
 * payment row we wrote. Failure is not fatal — refund linking degrades to a
 * customer lookup — so this never throws into the money path.
 */
export async function paymentIntentOf(invoiceId: string): Promise<string | null> {
  try {
    const payments = await getStripe().invoicePayments.list({ invoice: invoiceId, limit: 1 })
    const payment = payments.data[0]?.payment
    const pi = payment?.payment_intent
    if (!pi) return null
    return typeof pi === "string" ? pi : pi.id
  } catch (error) {
    console.error("[billing/subscription/paymentIntentOf]", error)
    return null
  }
}

/* ─── Stripe's copy of a plan ─────────────────────────────────────────────── */

/** True when the key in use is a live key rather than a test one. */
export function stripeIsLive(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live")
}

export type SyncablePackage = {
  id: string
  name: string
  priceCents: number
  minutesIncluded: number
  overageRateCents: number
  stripeProductId: string | null
  stripePriceId: string | null
}

/**
 * Make sure this plan exists in Stripe as a monthly price, and return its id.
 *
 * Nobody builds products by hand in the Stripe dashboard. The plan defined in
 * the admin area is the single source of truth and Stripe is made to follow it,
 * because two lists of plans maintained by two different people drift, and the
 * way you find out they have drifted is a customer paying the wrong amount.
 *
 * The cached id is re-checked rather than trusted, for three reasons that all
 * happen in practice: the price may have been archived in the dashboard, the
 * plan's price may have been edited here since, and the id may belong to the
 * other Stripe mode entirely — a local dev run on test keys writes a test price
 * id into the same row production reads with a live key.
 *
 * That last case is why `livemode` is checked. When it does not match we make a
 * new price and overwrite, which is harmless: prices are free, and a
 * subscription holds its price by id forever, so nobody's billing moves.
 */
export async function syncPackagePrice(pkg: SyncablePackage): Promise<string> {
  const stripe = getStripe()
  const live = stripeIsLive()

  if (pkg.stripePriceId) {
    try {
      const price = await stripe.prices.retrieve(pkg.stripePriceId)
      const usable =
        price.active &&
        price.livemode === live &&
        price.currency === "usd" &&
        price.unit_amount === pkg.priceCents &&
        price.recurring?.interval === "month" &&
        price.recurring?.interval_count === 1

      if (usable) return price.id
    } catch (error) {
      // resource_missing, or a key for the other mode. Either way we rebuild.
      console.error("[billing/subscription/priceStale]", error)
    }
  }

  // The product may still be good even when the price is not — a price change
  // needs a new price, never a new product, so subscribers stay on one product
  // and the dashboard reads as one plan rather than a graveyard of near-copies.
  let productId = pkg.stripeProductId
  if (productId) {
    try {
      const product = await stripe.products.retrieve(productId)
      if (!product.active || product.livemode !== live) productId = null
    } catch {
      productId = null
    }
  }

  if (!productId) {
    const product = await stripe.products.create({
      name: `${pkg.name} plan`,
      description: `${minutesLabel(pkg.minutesIncluded)} of calling included each month, then ${usd(pkg.overageRateCents)} per minute.`,
      metadata: { packageId: pkg.id },
    })
    productId = product.id
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: pkg.priceCents,
    recurring: { interval: "month", interval_count: 1 },
    metadata: { packageId: pkg.id },
  })

  await prisma.package.update({
    where: { id: pkg.id },
    data:  { stripeProductId: productId, stripePriceId: price.id },
  })

  return price.id
}

/* ─── Finding things ──────────────────────────────────────────────────────── */

/**
 * Which tenant an event is about.
 *
 * Three routes, tried in order of how much they prove. Metadata is what we set
 * ourselves and is carried on the object; the subscription id and the customer
 * id are what Stripe knows. Any one of them is enough, and having all three
 * means a webhook that arrives with metadata stripped — a subscription created
 * by hand in the dashboard, say — still lands on the right workspace instead of
 * being silently dropped.
 */
export async function resolveTenantId(opts: {
  metadataTenantId?: string | null
  subscriptionId?: string | null
  customerId?: string | null
}): Promise<string | null> {
  if (opts.metadataTenantId) {
    const byMeta = await prisma.tenant.findUnique({
      where:  { id: opts.metadataTenantId },
      select: { id: true },
    })
    if (byMeta) return byMeta.id
  }

  if (opts.subscriptionId) {
    const bySub = await prisma.tenant.findUnique({
      where:  { stripeSubscriptionId: opts.subscriptionId },
      select: { id: true },
    })
    if (bySub) return bySub.id
  }

  if (opts.customerId) {
    const byCustomer = await prisma.tenant.findFirst({
      where:  { stripeCustomerId: opts.customerId },
      select: { id: true },
    })
    if (byCustomer) return byCustomer.id
  }

  return null
}

const PACKAGE_FIELDS = {
  id: true, name: true, minutesIncluded: true,
  priceCents: true, overageRateCents: true,
} as const

/**
 * The plan a Stripe price belongs to.
 *
 * The obvious lookup is the cached id on the plan row, and most of the time
 * that is the answer. It is not always, and the case where it is not matters:
 * an operator edits a plan's price, a new immutable Stripe price is created,
 * and the row now points at the new one — while every existing subscriber is
 * still on the old price they agreed to. Their renewal invoice arrives quoting
 * a price this table no longer knows, and a null here would mean their
 * allowance quietly failing to renew.
 *
 * So a miss falls back to the price's own metadata, which carries the plan id
 * it was created for and, unlike our row, never moves. One extra API call, only
 * ever on the path that would otherwise have got it wrong.
 */
export async function packageForPrice(priceId: string | null) {
  if (!priceId) return null

  const direct = await prisma.package.findFirst({
    where:  { stripePriceId: priceId },
    select: PACKAGE_FIELDS,
  })
  if (direct) return direct

  try {
    const price = await getStripe().prices.retrieve(priceId)
    const packageId = price.metadata?.packageId
    if (!packageId) return null

    return await prisma.package.findUnique({
      where:  { id: packageId },
      select: PACKAGE_FIELDS,
    })
  } catch (error) {
    console.error("[billing/subscription/packageForPrice]", error)
    return null
  }
}

/** The customer id off any Stripe object that carries one. */
export function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!customer) return null
  return typeof customer === "string" ? customer : customer.id
}

/** The id off a field Stripe may or may not have expanded. */
export function idOf<T extends { id: string }>(value: string | T | null | undefined): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}
