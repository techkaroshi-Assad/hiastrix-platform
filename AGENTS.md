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
