# Hi-Astrix

AI voice agents that answer calls, qualify callers and update the CRM before the
caller hangs up. Multi-tenant, operated by Astrix Digital Media at
[app.hiastrix.com](https://app.hiastrix.com).

---

## What it is

Two audiences share one codebase.

**Tenants** — the businesses whose phones get answered. They sign in, build voice
agents, assign phone numbers, listen back to calls, read analytics, invite
colleagues, and top up their balance.

**Operators** — Astrix. A separate admin console for provisioning tenants,
allocating numbers, defining packages, granting credit, connecting the CRM and
mapping each tenant to their own CRM sub-account.

A rule runs through the whole thing: **no vendor is ever named in a tenant-facing
surface.** Not in the UI, not in an error message, not in the JSON a tenant can
open in the agent editor, not in an outbound email. Everything underneath is
"the voice platform", "the CRM", "payments". `src/lib/errors.ts` is where that is
enforced — every third-party failure is caught and mapped to a written message,
and anything unrecognised falls through to a generic one rather than leaking a
provider's wording.

---

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 ·
Prisma 7 with the `pg` adapter · PostgreSQL and auth on Supabase ·
Stripe · Resend · deployed on Vercel.

Two deliberate choices worth knowing before you change anything:

**Nothing is instantiated at import time.** `src/lib/prisma.ts` is a lazy Proxy
and `src/lib/stripe.ts` caches on first use, so a missing environment variable can
only ever break the request that needs it — never the build.

**A missing key hides a capability, it does not crash.** Each vendor module
exports a `…Configured()` predicate (`stripeConfigured`, `emailConfigured`,
`crmConfigured`) and the UI degrades quietly when it returns false.

---

## Layout

```
src/
  app/
    (legal)/            terms, privacy
    admin/              operator console
    dashboard/          tenant workspace
    api/
      admin/            operator-only endpoints
      agents/           agent CRUD, test calls, number assignment
      crm/options       dropdown data for the agent builder
      tools/crm         CRM actions, called mid-call by the voice provider
      webhooks/         call lifecycle + payments
    invite/[token]      public invitation acceptance
  components/
    agents/             tools editor, JSON editor
    app/                shell, tables, charts, icons
    auth/               sign-in and sign-up layouts
    brand/              logo
    theme/              light/dark provider and toggle
    ui/                 fields, forms, canvases
  lib/
    billing/            usage metering and cap enforcement
    crm/                CRM client, tool handlers, argument schemas, guidance
    supabase/           server-side auth clients
    vapi/               agent config, assistant payload, tool catalogue
prisma/schema.prisma
scripts/                one-off operational probes
```

---

## Environment

Every secret is a Vercel environment variable. **There is no `NEXT_PUBLIC_`
variable anywhere in this codebase and none should be added** — the two Supabase
modules and the proxy carry explicit comments saying so.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres, via the Supabase transaction pooler on 6543 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Auth |
| `VAPI_API_KEY` | Voice platform, server side |
| `VAPI_WEBHOOK_SECRET` | Shared secret on the call webhook **and** the CRM tool endpoint |
| `VAPI_PUBLIC_KEY` | Browser calling in the agent tester |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email |
| `CRM_CLIENT_ID`, `CRM_CLIENT_SECRET`, `CRM_APP_ID` | CRM marketplace app |
| `APP_URL` | Absolute base for webhooks, invites and redirects |

The one exception to "secrets live in the environment" is the CRM agency token.
It is granted at runtime through OAuth and rotates, so it cannot be a static
variable — it lives in the `crm_connection` table, which is the only place the
platform stores a live vendor credential.

---

## Running locally

```bash
npm install          # postinstall runs prisma generate
npm run dev
```

Point `DATABASE_URL` at the Supabase **transaction pooler** (port 6543), not the
direct connection — the direct host is IPv6-only and unreachable from Vercel, and
using it locally hides that.

Schema changes are applied as SQL against the live database rather than through
`prisma migrate`; `prisma/schema.prisma` is then updated to match. `npx prisma db
pull` is the quickest way to confirm the two agree.

---

## The parts worth understanding

### Agent configuration

An agent row holds a `config` JSON column. `src/lib/vapi/config.ts` owns it and
draws a distinction that matters:

- `AgentConfigSchema` — field-level only. Used by `readConfig`, deliberately
  lenient so a stored value that no longer validates cannot wipe the rest.
- `AgentConfigInputSchema` — adds cross-field rules. Used by every write path.

`readConfig` normalises the tool list **before** parsing the object. Without that,
one unrecognised tool would fail the whole parse and reset the prompt,
temperature, transcriber and twenty other fields to defaults — on the next render,
and permanently on the next save.

### Tools

`src/lib/vapi/tools.ts` is the single source of truth shared by the form builder,
the JSON editor and the API routes. A tool is either a tenant-authored `function`
pointing at their own endpoint, or one of eleven `crm.*` actions.

Every `crm.*` action is emitted to the voice platform as an ordinary function tool
pointed at `/api/tools/crm`. That indirection is the entire multi-tenancy story —
see below.

Switching a tool on grants a capability; it does not produce a behaviour.
`src/lib/crm/guidance.ts` closes that gap with two layers: `enforcedRules()` is
appended to the system prompt when the assistant is built and is not the tenant's
to remove, and `suggestedFlow()` is an editable draft the builder offers to paste
into their instructions.

### The CRM

Astrix owns one CRM agency. Every tenant is a sub-account inside it. One private
marketplace app is installed once, agency-wide, and its company token mints a
short-lived sub-account-scoped token per tenant on demand.

**The security boundary is one rule.** The sub-account a call may touch is derived
from the assistant that placed it — `assistantId → agent → tenant →
crmLocationId`. Nothing in a request body is consulted, and per-tool settings such
as the calendar or pipeline are re-read from the stored config rather than trusted
from the payload. A forged or malformed tool call therefore cannot reach another
tenant's data. Isolation is verified upstream too: a token minted for one
sub-account is refused with 403 against a sibling.

Two measured behaviours the code is shaped around, both written up in the project
docs: the contact search index lags a write by about **seven seconds**, so nothing
ever searches for a contact it just created; and applying an existing tag succeeds
with an empty `tagsAdded`, so tools report from that rather than from the status
code.

### Billing

`src/lib/billing/cap-enforcement.ts` meters each completed call. Minutes inside a
package allowance cost nothing and touch no balance. Only overage is charged, at
the package's rate, against the credit balance — and the ledger records every
movement. Billing writes only the money columns; the webhook owns the call
outcome, so the two never fight over `status`.

### Theming

`globals.css` carries two complete token blocks, dark and light, each with its own
`color-scheme`. Both must define **every** token — one defined in only one block
falls through to undefined, not to a default, and the element renders transparent.
Components never hardcode a colour; there are no `bg-white/[0.0x]` utilities left,
because they are invisible on a light background.

---

## Operational scripts

`scripts/` holds the probes used to verify the CRM integration against the live
agency. They are read-only apart from records they create and delete, and they
exist because several request shapes could not be settled from documentation.

```bash
node scripts/ghl-client-probe.mjs   # the requests the agent makes mid-call
node scripts/ghl-search-probe.mjs   # contact lookup strategies and index lag
```

`create-super-admin.sql` is run in the Supabase SQL editor to seed an operator.

---

## Conventions

Prose comments explain **why**, not what. If a line looks odd, there is usually a
sentence above it saying which failure it prevents — leave those in.

Errors reaching a tenant are written for a person, never a schema path.
`config.tools.7.pipelineId — Too small` is a bug, not a message.

API routes follow one shape: resolve the caller, return `apiError(ERRORS.UNAUTHORIZED, 401)`
if absent, `safeParse` the body, do the work, and `catch → apiError(sanitiseError(error, "context"))`.
Appending `/provider` to that context lets a validation message through in
vendor-free wording; anything else falls back to a generic line.

Operator identity goes to audit columns (`createdBy`, `connectedBy`), never to
anything a tenant renders.
