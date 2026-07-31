-- Hi-Astrix — plans become monthly subscriptions.
--
-- Until now a plan was bought outright: one charge, minutes reset, come back
-- when you want more. It is now a monthly subscription, so the database has to
-- carry three things it did not carry before — which subscription pays for the
-- plan, what state that subscription is in, and when the period it has paid for
-- runs out.
--
-- Top-ups are untouched. They are still a one-off charge that adds to a balance
-- and never expires, and they are still the only thing that credits the balance.
--
-- Every statement here is additive and re-runnable. Nothing is dropped and no
-- existing row changes meaning: a tenant with a package and no subscription is
-- a legitimate state (an operator-granted plan, or one bought under the old
-- one-off flow) and keeps working exactly as it did.

-- ─── 1 · Stripe's copy of each plan ──────────────────────────────────────────
-- A monthly price has to exist in Stripe before anyone can subscribe to it.
-- Rather than ask an operator to build products by hand in a dashboard and keep
-- them in step with ours, the app creates them on demand and remembers the ids
-- here. The plan defined in the admin area stays the single source of truth.

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id   text;

-- ─── 2 · Subscription state on the tenant ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE subscription_status AS ENUM (
      'TRIALING',
      'ACTIVE',
      'PAST_DUE',
      'CANCELED',
      'INCOMPLETE',
      'INCOMPLETE_EXPIRED',
      'UNPAID',
      'PAUSED'
    );
  END IF;
END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status    subscription_status,
  ADD COLUMN IF NOT EXISTS current_period_end     timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end   boolean NOT NULL DEFAULT false;

-- One tenant per subscription, enforced rather than assumed. A webhook replay
-- or a double checkout that produced two subscriptions for one workspace would
-- otherwise leave the second silently overwriting the first.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_subscription_id_key
  ON tenants (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- ─── 3 · Payments: invoices, and money given back ────────────────────────────
--
-- A one-off charge is identified by its payment intent. A subscription charge
-- is identified by its invoice — the newer Stripe API no longer carries a
-- payment intent on the invoice object at all, so there is nothing to key on
-- but the invoice id. Exactly one of the two columns is set per row, and both
-- are unique, so a replayed webhook of either kind finds the row it already
-- wrote instead of writing a second one.

ALTER TABLE payments
  ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  ADD COLUMN IF NOT EXISTS refunded_cents    integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_invoice_id_key
  ON payments (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- A row must be identifiable as one or the other. Without this a bug that
-- forgot to set either id would write unlimited duplicate payments, because
-- NULL is never equal to NULL and the unique indexes above would not object.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_one_stripe_ref;
ALTER TABLE payments ADD CONSTRAINT payments_one_stripe_ref
  CHECK (stripe_payment_intent_id IS NOT NULL OR stripe_invoice_id IS NOT NULL);

-- Never more than what was paid.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_refunded_within_amount;
ALTER TABLE payments ADD CONSTRAINT payments_refunded_within_amount
  CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);

-- ─── 4 · New enum values ─────────────────────────────────────────────────────
-- Added, never repurposed. Old rows keep the meaning they were written with.

ALTER TYPE payment_type      ADD VALUE IF NOT EXISTS 'SUBSCRIPTION';
ALTER TYPE payment_status    ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TYPE payment_status    ADD VALUE IF NOT EXISTS 'DISPUTED';
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'CHARGEBACK';

-- ─── 5 · Renewal lookup ──────────────────────────────────────────────────────
-- The billing page and the low-balance sweep both ask "whose period ends soon".

CREATE INDEX IF NOT EXISTS tenants_current_period_end_idx
  ON tenants (current_period_end)
  WHERE current_period_end IS NOT NULL;
