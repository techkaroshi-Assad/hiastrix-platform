/**
 * Stripe client — lazily constructed.
 *
 * Mirrors the Prisma pattern: nothing is instantiated at module import time,
 * so a missing key can never break a build, only the request that needs it.
 * The secret key lives in Vercel env only and is never returned to a client.
 */

import Stripe from "stripe"

let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("[Stripe] STRIPE_SECRET_KEY is not set.")

  cached = new Stripe(key)
  return cached
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

/** Preset top-up amounts, in USD cents. */
export const TOPUP_PRESETS = [2500, 5000, 10000, 25000] as const

export const MIN_TOPUP_CENTS = 500
export const MAX_TOPUP_CENTS = 500000
