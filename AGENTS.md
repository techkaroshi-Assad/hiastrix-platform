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
object, same as the base assistant gets. **Untested since the fix** — run
another campaign call with CRM tools on and confirm "What the agent did"
shows the lookup.

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
