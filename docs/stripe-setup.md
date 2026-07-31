# Stripe setup — Hi-Astrix

Everything you need to do in the Stripe dashboard, in order, and exactly which
two values end up in Vercel. Nothing else from Stripe is needed: the platform
never loads Stripe.js in a page, so there is no publishable key to manage and
no Stripe branding anywhere in the app except the hosted checkout page itself.

Do the whole of this in **test mode** first. The last section is the switch to
live, and it is four minutes' work once the rest is proven.

---

## What you are creating

| Value | Where it comes from | Where it goes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Developers → API keys | Vercel env, and `.env.local` |
| `STRIPE_WEBHOOK_SECRET` | Developers → Webhooks → your endpoint | Vercel env, and `.env.local` |

That is it. Two strings.

You do **not** need to create products or prices by hand. The platform creates a
Stripe product and a monthly recurring price for each plan the first time
somebody subscribes to it, and remembers the ids on the plan row. Plans stay
defined in the admin area, where they already are.

---

## 1 · The account

If you already have a Stripe account, skip to step 2.

1. Go to `stripe.com` and sign up with the business email you want invoices to
   come from.
2. Stripe will ask for business details to *activate* the account. You can skip
   that for now — **test mode works fully without activation**. You only need to
   complete it before taking real money.
3. Once you are in the dashboard, look at the top right. There is a **Test mode**
   toggle. Turn it **on**. Everything below happens with it on.

The dashboard shows an orange band when you are in test mode. If you cannot see
that band, you are in live mode and the keys you copy will be live keys.

---

## 2 · The secret key

1. Left sidebar → **Developers** → **API keys**.
2. You will see two keys. The one you want is **Secret key**, starting `sk_test_`.
3. Click **Reveal test key** and copy it.

Ignore the publishable key. We do not use it.

**Never paste a secret key into a chat, a ticket, a screenshot, or any file that
gets committed.** It is the equivalent of your bank login. If one ever leaks,
the fix is the **Roll key** button on that same page, which invalidates the old
one immediately.

---

## 3 · The webhook

This is the part that matters most, because the webhook is what actually moves
money in the platform. Nothing is credited, no plan is activated, and no minutes
are reset until Stripe tells us the payment cleared. A checkout redirect only
proves somebody reached a URL.

1. Left sidebar → **Developers** → **Webhooks** → **Add endpoint**.
2. Endpoint URL:

   ```
   https://app.hiastrix.com/api/webhooks/stripe
   ```

3. **Select events to send.** Do not choose "all events" — it works, but you will
   be paying attention to a lot of noise. Select exactly these nine:

   ```
   checkout.session.completed
   invoice.paid
   invoice.payment_failed
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   payment_intent.succeeded
   payment_intent.payment_failed
   charge.refunded
   charge.dispute.created
   ```

   (That is ten. Send all ten.)

4. Click **Add endpoint**.
5. On the endpoint's page there is a **Signing secret** — click **Reveal**. It
   starts `whsec_`. Copy it.

That signing secret is what proves an incoming request really came from Stripe.
Without it the endpoint rejects everything, which is the correct behaviour: an
unsigned request that could credit an account is not something to be lenient
about.

---

## 4 · Putting the two values in

### Vercel (this is the one that matters — it is what the live site reads)

1. `vercel.com` → the **hiastrix-platform** project → **Settings** → **Environment
   Variables**.
2. Add `STRIPE_SECRET_KEY`. Tick **Production**, **Preview** and **Development**.
3. Add `STRIPE_WEBHOOK_SECRET` the same way.
4. Go to **Deployments**, open the most recent one, and **Redeploy**. Environment
   variables are read at build and boot — an existing deployment will not pick
   them up on its own.

### Your machine

Add the same two lines to `C:\hi_astrix_local\hiastrix-platform\.env.local`:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

`.env.local` is already in `.gitignore`, so it does not get committed.

> **Replace the live keys that are in there now.** Your `.env.local` currently
> holds `sk_live_` and a live `whsec_`. Running the app locally against live keys
> means any test purchase you make is a real charge on a real card, and a bug in
> local code moves real money. Test keys locally, live keys only in Vercel
> production.

---

## 5 · Checking it works

Once redeployed, sign in as a tenant and go to **Billing**.

Use Stripe's test card — it is the only card that works in test mode:

```
Card number   4242 4242 4242 4242
Expiry        any future date, e.g. 12 / 34
CVC           any three digits, e.g. 123
Postcode      any, e.g. 10001
```

Two things to try:

**Add credit.** Put in $25. You should land back on the billing page, and within
a couple of seconds the balance reads $25.00 and a "Top up" row appears in credit
history. If the balance does not move, the payment worked and the webhook did
not — go to Developers → Webhooks → your endpoint and look at the delivery
attempts. A `400` there means the signing secret does not match; a `500` means
something in our code threw, and the message will be in the Vercel runtime logs.

**Subscribe to a plan.** Pick one. You should come back to a billing page showing
the plan, its renewal date, and your minutes reset to zero.

Other test cards, if you want to see the failure paths:

| Card | What happens |
|---|---|
| `4000 0000 0000 0002` | Declined. Nothing is credited, the payment shows as Failed. |
| `4000 0000 0000 3220` | Forces a 3D Secure prompt, then succeeds. |
| `4000 0000 0000 0341` | Attaches fine, then fails when the subscription charges it. |

### Testing renewals without waiting a month

In test mode, Stripe's **Billing → Subscriptions → the subscription → ⋯ →
Advance test clock** lets you jump the clock forward a month and watch the
renewal invoice land. That is the way to prove minutes reset on renewal without
waiting thirty days. You have to create the customer against a test clock for
this to be available, so the simpler check is: use the webhook endpoint's **Send
test webhook** button with `invoice.paid`, and confirm the tenant's minutes go
back to zero.

---

## 6 · Going live

Do this only once the test flows above all behave.

1. Complete Stripe's account activation — business details, bank account for
   payouts, and identity verification. Stripe will not release a live secret key
   for charges until this is done.
2. Turn the **Test mode** toggle **off**.
3. **Developers → API keys** → reveal the live secret key (`sk_live_`).
4. **Developers → Webhooks → Add endpoint** — the live-mode endpoint list is
   completely separate from the test one, so you have to add
   `https://app.hiastrix.com/api/webhooks/stripe` again and select the same ten
   events again. Copy the new signing secret; it is different from the test one.
5. In Vercel, change `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on
   **Production only**. Leave Preview and Development on the test values, so a
   preview branch can never take a real payment.
6. Redeploy production.
7. Make one real purchase with your own card — the smallest top-up, $5 — and
   check it lands. Then refund it from the Stripe dashboard and check the credit
   comes back off the balance. That single round trip proves the whole path,
   including the refund handling, with $5 of exposure.

### One thing to set before real customers

**Settings → Billing → Subscriptions and emails → Manage failed payments.**

Decide what Stripe does when a renewal card fails. The default retry schedule is
sensible; what you want to choose deliberately is what happens at the end of it.
Set it to **cancel the subscription**. The platform is built for that: a
cancelled subscription ends the minute allowance but leaves the credit balance
alone, so a customer who lapses falls back to paying per minute from whatever
credit they hold rather than being cut off mid-campaign.

---

## What the platform does with all this

Worth knowing, because it explains why the webhook list is what it is.

A **plan** is a monthly subscription. Stripe charges the card each month, and on
each successful invoice the platform resets the tenant's used minutes to zero and
stamps the next renewal date. That reset is driven by `invoice.paid` and nothing
else — not a redirect, not a timer, not the date. If Stripe did not take the
money, the minutes do not renew.

**Credit** is separate and is bought outright: a one-off charge that adds to a
balance and never expires. Credit pays for anything beyond the plan's included
minutes, and for everything if there is no plan.

The two are deliberately not mixed. Buying a plan does not add credit — the plan
gives minutes, and charging for those minutes *and* handing over their price as
credit would be giving the same minutes away twice.

**Nothing auto-charges.** When a balance runs low the platform emails and shows a
banner. It never takes money to top up on its own.

**Refunds reverse what they gave.** Refund a top-up in the Stripe dashboard and
the credit comes back off the balance, down to zero but never below. Refund a
plan payment and the plan ends. A chargeback does the same and additionally
suspends the workspace, because a disputed payment is a fraud signal and the
account should stop spending until a person has looked at it.
