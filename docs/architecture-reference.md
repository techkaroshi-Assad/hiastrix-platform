# Building a white-label voice-agent platform on someone else's voice API

A written-up implementation, for an engineer building something similar.

---

## Who this is for

You are putting a hosted voice-agent product in front of your own customers. The
speech, the model orchestration and the telephony come from a vendor — Vapi in
our case, Retell in yours — and everything the customer actually touches is
yours: the accounts, the agent builder, the call history, the billing, the CRM
integration.

We built that on Vercel and Supabase. You are building it on AWS, under HIPAA,
with a vendor who will sign a BAA. Most of the interesting decisions here are
unaffected by either of those differences, because they are about the *shape* of
wrapping a voice API for multi-tenant use rather than about which cloud it runs
on. The places where your constraints genuinely change the answer are called out
as they come up, and collected at the end.

The one thing worth saying before anything else: **almost none of the difficulty
was in the voice API.** Placing a call and getting a transcript back is a
weekend. The difficulty was multi-tenancy, tool calling, per-tenant CRM
isolation, and metering — and every one of those is your problem, not the
vendor's, however good their SDK is.

---

## 1 · What the thing is

Three audiences, three surfaces, one database.

**Tenants** — the businesses using the product. They sign in, build agents,
attach phone numbers, run outbound campaigns, read call recordings and
transcripts, and top up a balance.

**Operators** — us. A separate console for provisioning tenants, allocating
phone numbers, defining packages, granting credit, and connecting the CRM.

**The voice vendor and the CRM** — machine-to-machine, over webhooks and a
tool-call endpoint. Neither is ever named in anything a tenant can see.

Sixteen tables, about forty API routes, one Postgres. Deliberately no queue, no
worker fleet and no separate services; the reasons are in §6, and they may not
hold for you.

---

## 2 · The rule that shaped everything: the vendor is invisible

**No tenant ever learns which voice provider we use.** Not in the UI, not in the
JSON editor, not in an error message, not in a field name. Same for the CRM, the
payment processor and the database.

This started as white-label positioning and turned out to be load-bearing
engineering. It forces every vendor interaction through a translation layer,
which is exactly the layer you need when you swap a vendor — and swapping is
precisely what you are doing.

Three mechanisms enforce it:

**One module per vendor, and the credentials are read nowhere else.**
`lib/vapi/client.ts` is the only file that reads `VAPI_API_KEY`.
`lib/crm/client.ts` is the only one that touches the CRM's OAuth. A grep for the
env var is a complete list of the blast radius.

**Errors are laundered at the route boundary.** Every catch calls
`sanitiseError(err, context)`, which logs the raw error server-side and returns
one of a fixed set of tenant-facing strings. A provider 400 becomes "We couldn't
save your changes." — never the vendor's validation message, which routinely
names the vendor and its internal field names.

**Names are ours.** Tool types are `crm.contact.find`, not the provider's
`gohighlevel.contact.get`. Environment variables are `CRM_CLIENT_ID`, not
`GHL_CLIENT_ID`. This matters more than it sounds: we found the vendor's own tool
type strings rendering verbatim in a JSON editor a tenant could open.

> **For you:** this discipline is also how you keep a BAA boundary legible. When
> an auditor asks which components touch PHI and which third parties see it, "these
> four modules, and no others" is an answer. "It's threaded through the codebase"
> is not.

---

## 3 · Multi-tenancy

Every tenant-facing row carries `tenant_id`, and every tenant-facing query
resolves the tenant through exactly one function:

```ts
// lib/tenant.ts
export async function getTenantContext() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return null

  const membership = await prisma.tenantUser.findUnique({
    where: { supabaseId: user.id },
    include: { tenant: { include: { package: true } } },
  })
  if (!membership || !membership.isActive) return null

  return { userId: user.id, email: membership.email, role: membership.type,
           tenant: membership.tenant }
}
```

Two things about this are worth copying.

**Scoping is a filter, not a check.** Routes do
`findFirst({ where: { id, tenantId: ctx.tenant.id } })` rather than fetching by
id and then comparing. A row belonging to another tenant reads as *not found*,
never as *forbidden* — so allocation is not discoverable across tenant
boundaries, and there is no branch where somebody forgets the comparison.

**Row-level security exists but is not what protects you.** RLS is enabled on
every table, with policies keyed on a `get_my_tenant_id()` function. The
application connects as the owner and bypasses it entirely. It is defence in
depth for anything holding an anon key, not the primary control. Say that out
loud in your design doc, because a reviewer who sees RLS enabled will assume it
is the control, and it is not.

Tables that are server-only — the CRM connection, the dialer queue, platform
settings — have RLS enabled with **no policies at all**, which denies everything
by default. That is a cheap, legible way to say "nothing with a browser-side key
has any business reading this."

---

## 4 · The provider seam — the part you will rewrite

Everything vendor-specific lives behind three files. If you are porting to
Retell, these are what you replace, and little else.

### `lib/vapi/client.ts` — the transport

One private `vapiRequest<T>()`, then named export objects. Nothing else in the
codebase makes an HTTP request to the vendor.

Two details that were not obvious until they hurt:

```ts
// Every request is bounded. Without this, one hung provider request waits
// forever. Inside a page request that is merely slow. Inside the dialer's
// tick loop it is fatal: one hung POST consumes the whole tick, the leads it
// claimed sit unreachable until their lease expires, and the campaign stalls.
const deadline = AbortSignal.timeout(timeoutMs)
const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
```

```ts
// 404 gets its own error type, because "the provider has never heard of this
// call" is information the reaper acts on, and it is not the same as "the
// provider is broken".
if (res.status === 404) throw new VapiNotFound(path)
```

### `lib/vapi/config.ts` — our schema for an agent

A Zod schema of about thirty fields, stored as JSON on the agent row. This is
**our** vocabulary, not the vendor's, and the difference is the point.

The single most important behaviour in this file is how it recovers from its own
history:

```ts
// readConfig does safeParse and returns DEFAULT_CONFIG on ANY failure — for the
// entire object. So one stale tool type, left over from a rename, silently reset
// temperature, prompts, PCI mode and 25 other fields on the next render.
//
// Fix: parse `tools` element-wise and drop entries that no longer validate,
// rather than discarding everything because of one of them.
```

We hit this by renaming four tool types. It would have quietly wiped
configuration on every existing agent. **If you store a versioned config blob,
decide now what happens when a field's shape changes**, and make the failure
granular. This is the single highest-consequence bug we found all project, and it
would have been invisible — no error, no log, just agents that gradually reverted
to defaults.

### `lib/vapi/payload.ts` — our config → their request body

One function, and the only place the vendor's field names appear. Assembles the
system prompt, the voice, the model, the tool definitions, the webhook block.

Two things are appended here rather than stored:

```ts
messages: [{ role: "system", content: core.systemPrompt + enforcedRules(config.tools) }]
```

The tenant's prompt plus rules we enforce. Appended at send, never stored: the
prompt they see and edit stays theirs, and if we improve the rules, every agent
gets the improvement without a migration.

`serverMessages` stays `["status-update", "end-of-call-report", "transcript"]`.
We deliberately do **not** add `tool-calls`, because each tool carries its own
`server.url` — adding it to the global list routes tool calls to the main webhook
as well, and the agent hangs mid-sentence waiting for a reply that endpoint does
not know how to give.

> **For you:** Retell's config surface differs but the seam is identical. Keep
> your own schema, keep the translation in one file, and resist the temptation to
> store the vendor's request body — the day they deprecate a field, a stored body
> is a data migration and a translated one is a code change.

---

## 5 · Tool calling — the most interesting part

The agent needs to do things mid-call: look a caller up, create a contact, check
a calendar, book. Vendors ship first-party integrations for exactly this, and
**we deleted ours**. Here is why, because the reasoning transfers.

### Why the vendor's native CRM tools were unusable

Vapi has `gohighlevel.contact.get` and friends. They bind to a single credential
connected once at the *organisation* level. We checked the API definition: none
of the tool schemas carries a credential id, and the credential object carries no
location.

So every tenant's agent would write into whichever single CRM account was
connected upstream. Tenant A's callers land in Tenant B's CRM.

That is not a limitation to work around later. It is a cross-tenant data leak,
and it is the reason the entire tool layer is ours.

> **This is the check to run on Retell before you build anything on their
> integrations.** Ask precisely: *can a single assistant, at call time, act against
> a credential chosen per call?* If the answer is "you connect one account per
> workspace", their integrations are single-tenant and you build your own. Under
> HIPAA the same question has teeth: an integration that cannot be scoped per
> tenant cannot be scoped per covered entity either.

### What replaced them

Ordinary function tools pointing at our own endpoint.

```
Agent decides to call find_contact
  → POST https://app.example.com/api/tools/crm      (x-vapi-secret)
     { message: { toolCallList: [{ id, name, arguments }],
                  call: { assistantId, … } } }
  → we resolve assistantId → agent → tenant → tenant.crmLocationId
  → we call the CRM with a token scoped to THAT sub-account
  → { results: [{ toolCallId, result: "Found Dana Reid, customer since 2023." }] }
```

Four properties of that endpoint matter:

**Tenant resolution never reads the body.** It goes
`message.call.assistantId → agent → agent.tenantId → tenant.crmLocationId`.
Per-tool settings — which calendar, which pipeline — are re-read from the stored
agent config, not trusted from the payload. A malformed or hostile tool call
cannot reach another tenant's data, because there is no field in the request that
could steer it.

**The response shape is not optional.** It must be
`{ results: [{ toolCallId, result }] }`. Our webhook's habit of returning
`{ ok: true }` for anything unrecognised would leave the caller listening to
silence — the agent waits, says nothing, and the person hangs up.

**Results are short spoken sentences, not JSON.** They are read aloud. CRM error
codes are mapped to plain language: a contact with no phone number is a normal
case, not an incident.

**Auth reuses the webhook secret** over the same header. Same trust boundary,
one fewer environment variable for an operator to get wrong.

### The two things that only show up against a live CRM

We probed both rather than assuming, and both changed the design.

**The search index lags writes by about seven seconds.** Measured, not guessed.
So a contact the agent created moments ago is not findable — which means every
write tool must take the id returned by `create` rather than searching again, and
a naive "look up, else create" loop makes duplicates. The lookup itself is
exact-first (a duplicate-detection endpoint answering from live data) with fuzzy
search as the fallback for names only.

**Applying a tag that is already present returns 200 with an empty `tagsAdded`.**
Reporting success from the status code would have the agent tell a caller it had
done something it had not.

Neither is in any documentation. Budget time for a probe script that writes a
record and reads it back — a 200 is not evidence.

### Tools are a capability, not a behaviour

The failure we did not anticipate: switching a tool on does nothing on its own.
An agent with booking enabled and nothing in its prompt about booking will hold a
perfectly pleasant conversation and never book anything — and from outside it
looks like the tool is broken.

Two mechanisms address it.

**Enforced rules**, appended at payload build, covering only what prevents damage
and only for tools actually switched on: look the caller up before creating them,
use the contact id from the create reply rather than searching again, only offer
calendar slots you actually checked, never read an id aloud.

**A live setup checker** in the editor that reads the prompt, the tools and the
settings, and reports what will not happen — a tool switched on that the prompt
never mentions, described in an order that produces duplicates, a template
placeholder left in, extraction enabled with no schema. Each finding offers a
line to insert. Matching is deliberately loose (subject words, not phrasings)
because the cost of a missed warning is one unhelpful agent, and the cost of a
false warning is a checker everybody learns to ignore.

We then pointed the checker at our own nine agent templates, and **five failed
it.** They are fixed and now held to that standard by a test.

---

## 6 · CRM integration: one agency, many sub-accounts

The architecture that makes per-tenant CRM work without asking tenants for
credentials.

We own one CRM agency account. Each tenant is a sub-account inside it. One
private marketplace app is installed once, agency-wide, with automatic
installation to future locations. Its company-level token mints a short-lived,
location-scoped token per tenant on demand.

```ts
// lib/crm/client.ts
async function agencyToken() { /* refresh + persist, see below */ }
async function locationToken(locationId) {
  // POST /oauth/locationToken with the agency token.
  // Cached in module scope by location, with its expiry.
}
```

Three decisions inside that are worth stealing:

**Re-mint location tokens, never refresh them.** They come back with their own
refresh token, and using it would mean per-tenant rotation bookkeeping across
every sub-account, where one lost write bricks that tenant. Re-minting is
idempotent. Cost is one extra call on a cold start.

**Guard the agency refresh with a conditional update.** The provider rotates the
refresh token on every use, so two concurrent lambdas both refreshing means one
writes a token the other has already invalidated — and a lost *agency* refresh
token breaks CRM access for every tenant at once.

```ts
const written = await prisma.crmConnection.updateMany({
  where: { id: true, refreshToken: row.refreshToken },   // the one we started from
  data:  { accessToken: fresh.access_token, refreshToken: fresh.refresh_token, … },
})
if (written.count === 0) { /* someone else rotated; re-read rather than overwrite */ }
```

**Prove isolation, don't assume it.** We took a token minted for sub-account A
and used it against sub-account B. 403. That test is the whole security argument
for this design, and it took ten minutes.

The one place this leaks into product design: the tenant sees dropdowns of
*their* calendars, pipelines, tags and custom fields, fetched live with their
location token. Nobody is ever asked to paste an identifier they would have to go
and find, and a picker means a typo cannot reach the model as a silently broken
tool.

> **For you:** if your CRM is Salesforce or Epic rather than a reseller platform,
> the shape still holds — one integration identity, per-tenant scoping resolved
> server-side at call time, never a credential in a tenant's hands. What changes
> under HIPAA is that the scoping boundary is now also a PHI boundary, so the
> isolation test stops being a nice-to-have and becomes evidence.

---

## 7 · The outbound dialer

The largest single piece, and the one most likely to differ for you, because our
constraints were unusual.

### What it does

A campaign is a list of people and an agent to call them. It works through the
list, paces itself, retries no-answers on a backoff, stops when the balance runs
out, and resumes from exactly where it stopped.

Four tables: `campaigns`, `campaign_leads` (the queue), `dial_attempts` (a
ledger, one row per dial), `suppressions` (do-not-call).

### The claim

One SQL statement takes a per-tenant transaction-scoped advisory lock, re-reads
the campaign under it, checks pause / throttle / kill switch / calling window /
**credit**, computes headroom against three concurrency tiers, and claims that
many due leads with `FOR UPDATE SKIP LOCKED`.

One statement because every seam between those checks is a window where the
answer changes underneath you. A call ends, a top-up settles, an operator pauses
the campaign, another tick claims the same leads — all real events on a busy
platform, and the cost of getting it wrong is calls a customer did not authorise.

Three details that make it correct rather than merely plausible:

- `SKIP LOCKED` is only legal on `SELECT`, so the lock lives in a CTE the
  `UPDATE` joins to. `FOR UPDATE` cannot be applied to a CTE reference, so the
  headroom arrives as `LIMIT (SELECT n FROM headroom)` — and `LIMIT 0` is exactly
  the "no headroom" behaviour you want.
- The state predicate **must be inside the locking sub-select**. Under READ
  COMMITTED, Postgres re-evaluates a locking select's own qualifiers against the
  new row version after a competing transaction commits. That is the mechanism
  that makes a row another worker already took disappear. Repeating it on the
  outer `UPDATE` is insurance, not the mechanism.
- **A short return does not mean an empty queue.** `LIMIT n` with `SKIP LOCKED`
  returns fewer rows under contention. Completion is asked separately with a
  `NOT EXISTS`. Inferring it from an empty claim marks live campaigns finished
  under exactly the load that makes them matter.

### Where concurrency is counted from — the bug worth reading

Not from the calls table: those rows are written lazily by the webhook, so a call
placed two seconds ago is not there yet, and pacing off them over-dials by
exactly the ramp — worst at the moment a campaign starts.

Not from the attempt ledger either, **which was our first design and was wrong**.
The ledger row is written a moment *after* the claim, so a second claim landing
in that gap saw nothing in flight and took a whole batch again. Measured against
the live database: with a concurrency cap of 3, two back-to-back claims returned
three rows each.

Counting from the lead row — the thing the claim statement itself transitions —
makes the count and the claim one statement, with no window at all. The same two
claims then return three and zero.

The general lesson: **if you are pacing against a limit, count from the row your
own atomic operation writes, not from a downstream record of it.**

### Ledger before provider

```
INSERT dial_attempts (state='PLACING', provider_call_id=NULL, lease=+90s)
POST /call
UPDATE dial_attempts SET provider_call_id = <id>, state='DIALING'
```

Step one before step two is what makes a lost response survivable: a row with no
provider call id means "we may have rung this person and we do not know", which a
reaper can resolve by asking the provider. With the ordering reversed there is no
record at all.

It is also what makes the double-dial guard real. A partial unique index over
live attempt states:

```sql
CREATE UNIQUE INDEX dial_attempts_one_live_per_number_idx
  ON dial_attempts (tenant_id, phone_e164)
  WHERE state IN ('PLACING','DIALING','IN_PROGRESS','RECONCILING');
```

A second campaign dialling the same person while a call is live gets a `23505`
and never reaches the provider. **The constraint is the coordination** — no lock,
no application logic, no race to lose. This is the single highest-leverage line
in the dialer.

### The lease rule

> A lease expiring never causes a dial. It only ever causes a question.

An expired lease is not evidence a call is dead; it is evidence you do not know,
and the only thing that resolves that is asking the provider. Re-dialling on a
timer is how a dialer rings somebody who is still on the phone to it.

The reaper asks: *ended* → apply the normal outcome transition; *still ringing*
→ extend the lease, change nothing; *404* → the call demonstrably never existed,
hand the attempt back; *provider unreachable* → leave it, ask next tick. When we
give up on an unattributable dial, the attempt is counted, not refunded — we may
well have rung that person, and ringing them twice is worse than ringing them
once.

### Pacing without a queue

The call-ended webhook starts the next call. A minute-by-minute heartbeat covers
what the pump cannot: campaigns with nothing in flight to be pumped by, expired
leases, calling windows reopening, and anything dropped.

Inside the webhook the order is deliberate — release the attempt first and inline
(frees a concurrency slot, and must not wait on the email sends that billing
does), bill second and inline (it is money, and it wants the provider's retry
semantics behind it), advance the campaign last and inside `after()` (it makes up
to eight provider requests; on the critical path it is the likeliest cause of a
timeout, and a webhook timeout means a retry, which means a second advance —
that is how a retry storm starts).

> **For you, this is the section that changes most.** We had no queue because
> Vercel gave us no worker. On AWS you have SQS, EventBridge and Step Functions,
> and you should use them: a visibility-timeout-driven consumer is a cleaner
> expression of the lease pattern than a cron and a reaper. What transfers is not
> the mechanism, it is the invariants — atomic claim, ledger before provider,
> expiry causes a question rather than a retry, and completion asked rather than
> inferred. Those are true whatever runs the loop.

### Guardrails, because a dialer is the one feature that can harass people

Calling window per campaign in the **recipient's** timezone, enforced inside the
claim SQL so no code path can dial around it. Leads due outside it are deferred,
never skipped. A per-tenant do-not-call list checked at import and again before
every dial. A cap of two calls to the same person in 24 hours across all
campaigns, in the database rather than in campaign config. Caller-ID rotation
across an agent's numbers with a per-number daily cap, because carriers
spam-label a number that dials all day. A platform-wide kill switch. And a
consent line forced into the system prompt of any agent running a campaign,
composed at dial time so there is nothing for a tenant to delete.

That last one has a subtlety worth flagging: a per-call system-prompt override
**replaces** the message rather than appending to it, so the tenant's own prompt
and the enforced rules have to be rebuilt into it. Sending only the extra
sentence silently strips an agent of its instructions mid-campaign.

---

## 8 · Metering and billing

Money is where a voice product either works or quietly bleeds.

**The model.** A package grants an allowance of minutes and an overage rate. A
tenant also holds a credit balance. Minutes inside the allowance cost nothing;
minutes beyond it come out of the balance at the overage rate. A tenant with no
package pays for every minute at the platform rate.

**Every figure is shown both ways** — minutes and money, side by side. "$1.30
left" tells nobody whether that is an afternoon or a fortnight.

**One predicate decides whether calls connect**, and getting it wrong costs real
money in both directions:

```ts
const canCall = minutesRemaining > 0 || balanceCents > 0
```

Not "balance above zero". A tenant who has just bought a plan sits at full
allowance and zero credit, and metering never charges them until they exceed it.

We shipped that wrong, twice, in opposite directions. The call routes gated on
`creditBalanceCents <= 0 && tenant.package`, so a tenant with **no package and no
balance called for free** while billing charged them anyway. Meanwhile the
post-call enforcement used raw `creditBalanceCents <= 0`, which took a customer
who had just bought a plan off the air on their first call. Both now go through
one function, and both are pinned by assertions that describe the bug.

**Enforcement lives in three places, and they must agree**: before an interactive
call, inside the dialer's claim SQL (as inline arithmetic — a broke tenant claims
zero leads, atomically, with no window between the check and the dial), and after
each call when the meter runs.

**Running out pauses rather than cancels.** Every lead keeps its state, attempt
count and next-attempt time, so a top-up carries on from exactly where it stopped
rather than re-calling everyone already reached. Only campaigns paused *for
money* resume automatically; one a person paused by hand stays paused.

**A vendor with no on/off switch.** Assistants have no `isActive`, no `status`,
no `enabled` — we were PATCHing a field that does not exist, and the provider
rejects unknown properties, so every toggle failed. That mattered well beyond the
button: the same call backed the rule that pauses a tenant at zero credit, so
that rule had silently done nothing for weeks. Availability is a property of the
**phone number** pointing at the assistant; clearing that pointer is how a number
stops being answered. Outbound is refused on our side.

> Check this on Retell in week one. "How do I take an agent off the air?" is a
> question with a real answer or a silent no-op, and the difference is invisible
> until you audit the calls that kept connecting.

---

## 9 · The operator console

A second surface behind the same auth, with a separate authorisation table.

Three things have to line up for an operator account, and each fails
differently: a row in `auth.users` **plus** a matching identity row (without the
identity, password sign-in fails even though the account visibly exists); a role
claim in app metadata, read at the edge to decide whether a request may reach the
console at all; and a row in `admin_users`, re-checked server-side by every page
because the claim is a routing hint, not the authorisation boundary.

**There is deliberately no sign-up route for the console.** Accounts are created
by a SQL script run in the database console. This is a defensible choice for a
handful of internal users and a bad one at scale — but it removes an entire
category of privilege-escalation surface, and for an early platform that trade is
worth making consciously rather than by accident.

One trap: rows inserted by hand leave token columns NULL, and the auth service
reads them into non-nullable string fields, so sign-in fails *before* the
password is checked with an error that says nothing about the cause. The
provisioning script writes empty strings and repairs existing rows.

Operators can provision tenants, allocate numbers, define packages, grant credit
with a tenant-facing description (operator identity goes to a separate audit
column the tenant UI never renders), map a tenant to a CRM sub-account, and
connect the CRM once for the whole platform.

---

## 10 · Verification, and why it is worth the trouble

430 assertions across ten harnesses, plus eleven that run against the real
Postgres. Not unit tests in the ceremonial sense — each one is a sentence about
behaviour, and several are the written record of a bug.

Some concrete returns:

- The migration-safety harness took a real agent row carrying a stale tool type,
  ran it through the new config reader, and asserted all twenty-five unrelated
  fields survived. That caught the silent config wipe described in §4.
- The contrast harness reads the stylesheet, resolves `var()` indirection and
  `rgba()` compositing, and does the WCAG arithmetic. It found that **every
  selected chip and status pill in the application was unreadable in light mode**
  — 1.44:1 — across ten shipped files. And it proved no step of the brand scale
  clears AA in both themes, so the fix had to be a token that flips.
- A scanner for functions exported from `"use client"` modules and called from
  server components. That pattern typechecks, builds, and throws at request time.
  It cost us one production outage before the scanner existed and caught the
  identical bug in new code afterwards.
- The templates are held to the product's own setup checker. Five of nine failed
  when first pointed at it.

The pattern worth copying: **write the assertion in the language of the
consequence.** "an expired lease never re-dials a call the provider says is live"
is a test whose failure message tells you what broke and why it matters. `expect(
reap()).toBe(1)` is not.

Also: verify against the real database where the behaviour *is* the database. The
concurrency accounting could not have been tested by mocking, and the bug in §7
would have shipped.

---

## 11 · What changes for you: AWS and HIPAA

Everything above is portable. These are the deltas.

**The BAA boundary is a diagram you have to be able to draw.** Voice vendor,
transcription, model provider, telephony carrier, CRM, email, error tracking,
logs. Any of them that can see call audio, transcripts, or a caller's identity is
in scope. Note that with a voice agent this is nearly all of them — a transcript
of a patient describing symptoms is PHI in the plainest possible way. Check
whether your vendor's model provider is covered by *their* BAA or whether you
need your own.

**We already have a precedent for the PHI-suppression pattern**, and it is
smaller than you would expect: a PCI mode that stops recordings and transcripts
being retained at all for a given agent. Duration, cost and summary still work.
The lesson from building it is that *partial* redaction is much harder than
complete suppression — deciding which words in a transcript are sensitive is a
model problem with a failure mode, whereas not storing the transcript is a
boolean. If your first HIPAA release can be "no retained audio or transcript on
PHI-handling agents", take it.

**Audit logging is not the same as our credit ledger.** We record who granted
credit and when. You need access logging: who read which call, when, from where.
Design that as a table, not as CloudWatch queries — an auditor's question is
"show me every access to this patient's record", and that has to be a query.

**Encryption at rest is table stakes; encryption in the app is the interesting
part.** Our one genuinely secret runtime value — rotating CRM OAuth tokens — is
the only thing the platform stores that is not an environment variable, and it
lives in a dedicated single-row table. On AWS put that in Secrets Manager or KMS
envelope encryption, and keep the property that made it manageable: exactly one
place in the code reads it.

**Data residency and deletion.** A voice vendor holds recordings and transcripts
on their side too. Find out the retention default, whether you can set it to
zero, and whether their delete is real. Our design pulls the recording URL and
transcript into our own database on the end-of-call webhook; under HIPAA you may
want the opposite — never persist them, fetch on demand, and rely on the
vendor's covered storage.

**AWS gives you the primitives we did without.** SQS with a visibility timeout
*is* the lease pattern, expressed better. Step Functions handle the retry-and-
backoff state machine we hand-rolled. EventBridge Scheduler replaces the cron we
ended up moving into `pg_cron` because our host's free tier capped scheduled jobs
at once a day. Take them — but keep the database as the source of truth for queue
state rather than the queue, because "which leads are outstanding for this
campaign" is a question the customer's UI has to answer, and a queue cannot.

**The bit that does not change.** Multi-tenant isolation resolved server-side
from an identifier the caller cannot influence; one module per vendor; errors
laundered at the boundary; the count that paces you coming from the row your own
atomic operation writes. Those held under every constraint we met and they will
hold under yours.

---

## 12 · If I were starting again

**Probe the vendor before designing around them.** Two of our three largest
rewrites came from assumptions about the voice API and the CRM that a two-hour
probe script would have killed on day one. Write records and read them back; a
200 is not evidence.

**Decide the config-versioning story before the first migration**, not after a
rename nearly wipes every agent.

**Build the metering predicate once, on day one, and test it against the shapes
that will exist later** — no package, package with allowance left, allowance
exhausted, negative balance. We wrote it three times and got it wrong twice.

**Assume the tool layer is yours.** Vendor integrations are built for
single-tenant use, and finding that out after you have shipped is expensive.

**Instrument the thing that is invisible.** A dialer that quietly stops, a tool
that is never called, a config that silently reverts — none of these produce an
error. Every one of them needed something deliberately built to make it visible.

---

*Written from the Hi-Astrix implementation: Next.js 16 on Vercel, Postgres on
Supabase, Vapi for voice, GoHighLevel for CRM, Stripe for payments. Sixteen
tables, forty routes, 430 assertions.*
