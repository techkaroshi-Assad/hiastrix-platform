<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Built but not yet tested on a live call

The user has not yet confirmed these on a real Vapi call. Do not treat them as
working, and do not remove this section until the user says they've tested
and it's fine — then delete the relevant line(s).

- **Lead context / CRM pre-dial lookup** (`lib/crm/lead-context.ts`,
  `lib/dialer/dial.ts`, `lib/dialer/consent.ts`) — CSV business-name column,
  pre-dial CRM lookup by phone/contact id, and injecting the result into the
  agent's prompt and `variableValues` for outbound calls. Also strengthened
  the inbound CRM-lookup instruction in `lib/crm/guidance.ts`.
- **Knowledge base — file upload + website URL** (`lib/vapi/knowledge.ts`,
  `app/api/agents/[id]/knowledge/route.ts`, `components/agents/knowledge-editor.tsx`)
  — end to end, including the UI. Specifically unverified: whether Vapi
  accepts `model.tools` and `model.toolIds` together on the same assistant
  (see the comment above `toolIds` in `lib/vapi/payload.ts`), and whether the
  model actually calls the query tool by the name assumed in the prompt
  instruction (`knowledge_search`) — if it uses a different internal name,
  the instruction won't match and the tool will go unused. Needs one real
  upload + one real call where the agent is asked something only the
  document would answer.
- **End-call fix** (`lib/vapi/payload.ts`'s `END_CALL_TOOL`,
  `lib/crm/guidance.ts`'s `CALL_END_LINES`) — attaches Vapi's built-in
  `endCall` function to every assistant and instructs the model on when to
  use it (caller says goodbye / has nothing further, but one objection isn't
  a goodbye). Needs a real call: say a plain goodbye and confirm it actually
  hangs up, and separately try a single soft objection ("not interested")
  and confirm it pushes back once instead of ending immediately.
- **Call action log fixes** (`lib/calls/actions.ts`, `components/app/call-actions.tsx`)
  — `endCall` no longer shows as a red "failed" action when its result never
  arrives (expected, since the call ends before a reply can come back), and
  built-in tools get readable labels. Depends on the end-call fix above
  actually firing on a live call to be checked at all.
- **Campaign → call detail link** (`app/dashboard/campaigns/[id]/page.tsx`)
  — the "What happened" column links to the full call record when one
  exists. Should work off existing data (no new webhook behaviour), but
  hasn't been clicked on a real campaign yet.

## First live test (2026-08-27) — findings

User tested a browser call against "Nancy" (Kaizen Systems). Confirmed
`knowledge_search` as the function name is correct — matches Vapi's query
tool docs and `lib/vapi/client.ts` exactly, so that specific unverified risk
above is cleared. What the test actually surfaced:

- Nancy looped on "may I ask your name" through two outright refusals, and
  separately re-opened with "good morning" mid-call more than once. Neither
  is something this platform coded on purpose — most likely the tenant's own
  prompt has no fallback when a caller declines, compounded by a rough
  connection. Added an unconditional instruction against both in
  `lib/crm/guidance.ts` (`CONVERSATION_LINES`) as a safety net regardless of
  root cause. **Untested** — needs the same kind of call again to confirm it
  actually stops.
- The knowledge base didn't answer a question about what Kaizen Systems
  does, despite a website URL being added. Root cause not confirmed — could
  be the page being JavaScript-rendered (this platform has no browser to
  execute it, only a raw fetch) producing little or no real text, or the
  model simply never calling the tool. Added a preview of the actually-
  extracted text plus a "this looks thin" warning to the knowledge editor UI
  (`components/agents/knowledge-editor.tsx`) so this is diagnosable without
  guessing next time. **Action for the user**: re-open that agent's
  knowledge section and look at the preview under the Kaizen Systems URL —
  if it's a warning and a near-empty snippet, the page needs a JS-rendering
  workaround (not yet built); if it looks like real page text, the problem
  is the model not calling the tool, which is a different fix.
- The repeated "good morning" and noticeable delay may substantially be a
  browser-mic-test artifact (speaker audio bleeding into the mic, read back
  as if the caller interrupted) rather than a code bug — this needs
  confirming on a real phone call before spending more effort chasing it as
  a bug.
- The preview feature worked and confirmed the kaizenus.com scrape did get
  real text — but it was mostly the nav menu ("About Us Value Analysis
  Benefits Case Studies Industry Overview Services") outweighing the one
  actual line of substance ("Medical Billing Services for Small Practices").
  `htmlToText` in `lib/vapi/knowledge.ts` now strips `<nav>`, `<header>`,
  `<footer>`, `<aside>` before converting to text. **Confirmed fixed** — the
  re-added URL's preview came back as real prose ("Kaizen helps healthcare
  providers across the USA improve cash flow with reliable medical
  billing...").

## First live campaign test (2026-08-27) — found and fixed a severe bug

User ran a real campaign call ("Nancy" / Kaizen Systems, outbound to a
practice's front desk). The call detail page said "This agent has no tools
switched on" even though the agent's CRM tools were actively toggled on and
saved. Traced it: `campaignOverrides()` in `lib/dialer/consent.ts` builds a
per-call `assistantOverrides.model` object with `provider`/`model`/`messages`
but never `tools` or `toolIds`. A call override replaces the assistant's
`model` object for that call rather than merging into it, so every campaign
call — not just this one — ran with **none** of the agent's tools: no CRM
actions, no knowledge search, and no `endCall` either. This was silently
breaking three separate features built this session, all at once, on every
real outbound dial. **Fixed**: `toolsPayload()` exported from
`lib/vapi/payload.ts` and now included in `campaignOverrides()`'s model
object, same as the base assistant gets. **Confirmed fixed** — a later
campaign call ("Dynamic Chiropractic") showed a real action in the log
(`endCall` firing, "Ended because: Assistant-ended-call"), proving campaign
calls now carry their tools end to end.

Also from that same call: the CRM contact name on file was the practice's
own doctor, but a receptionist answered, and the (then-hardcoded) obligation
telling the agent to "address them by name in your first sentence" would
have had it greet her as "Doctor" — the model quietly didn't do this, good
judgement rather than being told not to. Per the user's explicit request,
this is no longer a fixed platform rule: added `leadContactRelationship`
("direct" | "front-desk") to `AgentConfigSchema` in `lib/vapi/config.ts`,
exposed as a Select under Call control → "Who's on the list" in
`agent-editor.tsx`, and `campaignSystemPrompt()` in `consent.ts` now branches
on it instead of always assuming the name is who answers. Defaults to
"direct" (today's old behaviour) so nothing changes for an agent until the
tenant sets it. **Untested** — set this Kaizen agent to "front-desk" and
confirm the next call to a practice number asks for the name rather than
assuming it.

Separately, the tenant's own prompt for this agent treats "that's not the
right person" the same as an outright refusal and ends the call — worth a
prompt fix (in the tenant's own systemPrompt, not platform code) if it comes
up again: a receptionist saying "no, not me" should prompt "who is, then?",
not an immediate close.

## Phone menus (IVR) — the agent had no keypad (2026-09-21)

Read Kaizen's production data directly: 291 of 672 outbound calls (43%) hit
an IVR. Transcripts show the agent saying "Pressing 4 for billing", the menu
replaying, "Pressing 4 again", "Pressing 0" — and the tool log for those
calls shows **zero** keypad calls, because no `dtmf` tool was ever attached
(`keypadInputEnabled` is Vapi's plan for *receiving* digits on inbound, not
sending). 44 of those calls ran to `silence-timed-out`, up to 7 minutes each,
all billed and all counted as "connected".

Built, per the user's "must be a visible control on the agent": three
config fields (`ivrNavigationEnabled`, `ivrTarget`, `ivrMaxAttempts` in
`lib/vapi/config.ts`), a "Phone menus" block under Call control in
`agent-editor.tsx`, the `{ type: "dtmf" }` tool attached in `toolsPayload()`
only when enabled (so campaign overrides get it too), and a "Phone menus"
rules block in `lib/crm/guidance.ts` (`ivrLines`) written against Vapi's own
IVR guide: wait for the full menu, reply with " " while listening, leading
`w` pause on digits, retry slower with `W`, escalate to 0, bounded rounds
then `endCall`. Prompt-check now flags an outbound agent without it. All
outbound templates default it on; existing agents default **off** until the
tenant flips it. **Untested on a live call** — Kaizen's Nancy needs the
toggle switched on, then a campaign call into a practice with a menu, and
the call detail should show "Pressed keys on a phone menu · pressed: 4"
in the action log. Watch for: Vapi rejecting `dtmf` alongside `endCall`
in `model.tools` (both built-in; shouldn't conflict but unverified), and
the model still narrating "pressing" despite the rule.

**Deployed** (f67d981) — still needs the toggle switched on for Nancy and a
live menu call to confirm.

## Outbound outcomes: extraction, honest analytics, report (2026-09-21)

All built in one pass from the same production review. None of it has
been seen on a live call yet. The pieces, and what to check:

- **Outbound extraction preset** — `lib/agents/extraction-presets.ts`
  (`OUTBOUND_PRESET_FIELDS`, keys in `OUTBOUND_KEYS`), offered as a
  "Start from: Outbound cold call" button next to "What to pull out" in the
  agent editor, with a warning when a campaign agent isn't using it. Plain
  text fields with "exactly one of" in the description, because the schema
  form has no enums. `lib/vapi/analysis.ts` now writes every analysisPlan
  with a who-is-who system message (`{{schema}}`/`{{transcript}}` are
  Vapi's template variables — **unverified** that `{{schema}}` is
  substituted in `structuredDataPlan.messages`; if extraction comes back
  empty after this deploy, that's the first suspect: drop `{{schema}}`
  from the message and rely on `structuredDataPlan.schema`). Campaign
  calls override `analysisPlan` per call with the outbound framing in
  `campaignOverrides()` — **unverified** that `assistantOverrides`
  accepts `analysisPlan`; if a campaign call 400s after deploy, remove
  that key first. **Action for the user**: open Nancy → After the call →
  Pull out specific details → "Start from: Outbound cold call" → save,
  then check a campaign call's Extracted data shows whoAnswered /
  interestLevel about the *other* party, not Nancy.
- **`calls.reached` + `calls.ivr_seen`** — migration applied directly to
  Supabase (columns + index `calls_tenant_reached_idx`); all existing rows
  backfilled with a SQL port of `lib/calls/reached.ts`. Kaizen's real
  numbers: 243 HUMAN / 239 IVR / 129 VOICEMAIL / 52 NO_ANSWER / 9 FAILED
  of 672 — 36% reached a person, vs 92% "connected" before. The heuristic
  is a transcript pattern match (menus say "press 1", people say "yes /
  speaking / hold on"); the agent's own `whoAnswered` takes precedence
  when present. Spot-checked three times against random samples; expect
  a few percent of residual error on calls with no extraction. Set in the
  Vapi webhook at end-of-call. **Local dev needs `npx prisma generate`**
  after pulling — the sandbox cannot reach Prisma's engine CDN, so the
  client wasn't regenerated here; Vercel's postinstall does it.
- **Analytics** (`lib/analytics.ts`) — "Connected" is now
  `COALESCE(reached = 'HUMAN', duration_seconds >= 10)` everywhere,
  labelled "Reached a person". New `lib/campaigns/insights.ts` joins
  `dial_attempts.provider_call_id = calls.vapi_call_id` and unpacks the
  extraction; `components/campaigns/outcomes.tsx` renders it on each
  campaign page and on Analytics (with a per-campaign table).
- **Report** — `GET /api/reports/campaign?campaignId=|days=|from=&to=&transcripts=1`
  streams an .xlsx built by `lib/xlsx.ts`, a dependency-free writer
  (exceljs was tried; its install did not finish in the sandbox and a
  half-installed `node_modules/exceljs` may be left on disk — it is
  gitignored and safe to delete). Validated with openpyxl: zip integrity,
  both sheets, formats, bold, freeze, autofilter, escaping. **Untested in
  a browser**: click "Download report (Excel)" on a campaign page and open
  it in Excel.
- **Campaign "no phone number" pause** — root cause was Hi-Astrix's own
  `number_daily_call_cap` (200/24h per number) counting every attempt,
  including the 190 `call.start.error` ones that never rang. Now:
  attempts with `astrix-rejected` or `call.start.error*` don't count;
  "all numbers capped" throttles until the oldest call ages out
  (`throttledUntil`) instead of pausing, and `whyIdle()` says "Daily
  limit reached … resumes at HH:MM" instead of "no phone number";
  only "no number attached at all" still pauses. **Action for the user**:
  Resume the Kaizen campaign after deploy; allocate the new Twilio
  `+13134584952` to Kaizen and attach it to Nancy so she rotates across
  two purchased numbers.

## PDF activity report + honest lead states (2026-09-22)

- **Dialer no longer calls a menu "Spoke to them".** `classifyOutcome()` in
  `lib/dialer/outcome.ts` takes `reached` (from the webhook); IVR → new
  outcome `IVR_ONLY` (retries on a 2h/20h curve, note "Reached a phone
  menu, not a person"), VOICEMAIL/HUMAN from the transcript classifier
  win over the duration rule. Campaign page "Spoke to a person" and the
  campaigns list "Spoke to" now count distinct leads with a HUMAN call.
  **Data correction applied in Supabase at the user's request**: 321
  COMPLETED leads whose latest call was IVR/voicemail/no-answer were put
  back to RETRY_WAIT (next attempt +2h) across 6 campaigns, 4 with no
  attempts left relabelled EXHAUSTED; the 5 finished campaigns holding
  re-queued leads were set to PAUSED with a pausedReason saying why.
  75-560 was left RUNNING. **Untested**: watch a menu-only call land as
  "Trying again later" with the new note rather than "Spoke to them".
- **`lib/pdf.ts`** — dependency-free PDF 1.4 writer (Helvetica AFM
  widths, deflate streams, tables with wrapped/repeated headers, KPI
  boxes, bar/column charts). Validated: pypdf parses, pdftoppm renders,
  visually checked. **`lib/reports/activity.ts`** — the tenant activity
  report (every call + campaign outcomes + callbacks + objections +
  agents + method note); `GET /api/reports/activity?from=&to=` streams
  it. Analytics page has a date-range picker with PDF / Excel buttons;
  campaign pages have a PDF button. Kaizen's 1 Sept–21 Sept report was
  generated offline from the same code and the live data and handed to
  the user. **Untested in the app**: click the PDF button after deploy —
  first suspect if it 500s is `dayStart()` timezone maths in the route.
- Known limits of the PDF writer: ASCII/WinAnsi only (non-Latin text
  becomes "?"), no images, no embedded fonts. Fine for this report;
  revisit if a tenant needs a non-Latin script.

## Super admin — phone number type tagging (2026-08-27)

After a campaign hit `call.start.error-vapi-number-outbound-daily-limit`
(Vapi's hard cap on its free, shared-pool numbers), added a `provider`
column to `PhoneNumber` (`prisma/schema.prisma`), populated from Vapi's own
`provider` field (`"vapi"` vs `"twilio"`/`"telnyx"`/`"vonage"`/
`"byo-phone-number"`) on every sync (`app/api/admin/numbers/route.ts`). The
super admin numbers page (`app/admin/numbers/page.tsx`) now shows a "Type"
column per number and a warning banner when any free Vapi-managed numbers
are in inventory, explaining they're fine for testing but shouldn't sit
behind a real campaign. **Requires a manual SQL migration** — this repo has
no `prisma migrate` history, only hand-written SQL — the user still needs to
run `ALTER TABLE phone_numbers ADD COLUMN provider text;` against the live
database before this deploys cleanly. **Untested**: existing rows will show
"Unknown" until the next "Sync inventory" click; needs one sync plus a look
at the page to confirm the banner and Type column render as expected, and
ideally a real Twilio number imported into Vapi to confirm it tags as
non-free.
