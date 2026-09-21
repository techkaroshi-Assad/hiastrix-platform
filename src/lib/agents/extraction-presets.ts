/**
 * Ready-made "what to pull out" lists.
 *
 * ── WHY A PRESET AND NOT A HARD-CODED SCHEMA ──────────────────────────
 *
 * The first production outbound campaign extracted `callerName: "Nancy"` on
 * every call — Nancy being the agent. The starter fields were written for an
 * inbound receptionist ("the caller's name", "what they want"), and on a
 * call the agent placed, the model dutifully answered about the only
 * "caller" there was. Nothing about the person who actually picked up.
 *
 * The fix is not to bake an outbound schema into every agent: an inbound
 * agent still wants the caller's name. It is to offer the right starting
 * point as a one-click preset the tenant applies and can then edit like any
 * other field list. What the preset asks for is what a sales lead wants to
 * see the morning after a campaign ran: who answered, did we get to the
 * decision-maker, are they interested, do we owe a callback.
 *
 * ── WHY THE "ONE OF" VALUES LIVE IN DESCRIPTIONS ──────────────────────
 *
 * The field form deliberately does not support enums (see
 * lib/agents/schema-builder.ts). A preset that used them would open in the
 * raw-JSON escape hatch, which defeats the point of a preset. The extractor
 * follows a description that lists the allowed values just as reliably in
 * practice, and lib/calls/outcome.ts normalises whatever comes back.
 *
 * Keys are derived by `toKey` from the names, so `OUTBOUND_KEYS` below must
 * match — there is a test-shaped assertion at the bottom to keep them honest.
 */

import { toJsonSchema, toKey, type SchemaField } from "@/lib/agents/schema-builder"

export const OUTBOUND_PRESET_FIELDS: SchemaField[] = [
  {
    name: "Who answered",
    type: "string",
    description:
      "Exactly one of: decision-maker, gatekeeper, ivr, voicemail, nobody. " +
      "'gatekeeper' is reception, front desk or any staff member who is not the person we asked for. " +
      "'ivr' if only an automated menu was heard. 'nobody' if no one and nothing answered.",
    required: true,
  },
  {
    name: "Reached decision maker",
    type: "boolean",
    description:
      "True only if the assistant actually spoke with the person who can make the decision " +
      "(the owner, practice manager, billing manager, or whoever the assistant was asking for).",
    required: true,
  },
  {
    name: "Contact name",
    type: "string",
    description:
      "The name of the person on the other end who spoke with the assistant, or the person they said to ask for. " +
      "This is the business's side — never the assistant's own name. Blank if none was given.",
    required: false,
  },
  {
    name: "Contact role",
    type: "string",
    description: "Their role if stated or obvious: receptionist, office manager, owner, billing, doctor, etc.",
    required: false,
  },
  {
    name: "Interest level",
    type: "string",
    description:
      "Exactly one of: interested, maybe, not-interested, unknown. " +
      "'unknown' when no real conversation happened (menu, voicemail, hung up immediately).",
    required: true,
  },
  {
    name: "Callback requested",
    type: "boolean",
    description: "True if they asked to be called back, or said a better time or person to reach.",
    required: true,
  },
  {
    name: "Callback when",
    type: "string",
    description:
      "When and who, in their words — e.g. 'tomorrow after 2pm, ask for Maria'. Blank if no callback was arranged.",
    required: false,
  },
  {
    name: "Best number",
    type: "string",
    description: "A different phone number they gave for reaching the right person, if any.",
    required: false,
  },
  {
    name: "Objection",
    type: "string",
    description:
      "If they were not interested, the reason in their words — 'we already have a billing company', 'not the right person', 'don't call again'. Blank otherwise.",
    required: false,
  },
  {
    name: "Key facts",
    type: "list",
    description:
      "Useful things learned about the business: how they handle this today, size, pain points, timing. Short items, one fact each.",
    required: false,
  },
  {
    name: "Next action",
    type: "string",
    description:
      "Exactly one of: call-back, send-info, remove-from-list, done. " +
      "'remove-from-list' if they asked not to be called again. 'done' if nothing further is owed.",
    required: true,
  },
  {
    name: "Ivr outcome",
    type: "string",
    description:
      "If an automated menu answered: exactly one of reached-human, voicemail, looped, no-option. " +
      "'looped' if the menu kept repeating; 'no-option' if nothing on it led to a person. Use 'none' if no menu was heard.",
    required: true,
  },
]

/** The JSON Schema string the preset becomes — what the editor stores. */
export const OUTBOUND_PRESET_SCHEMA = toJsonSchema(OUTBOUND_PRESET_FIELDS)

/**
 * The keys the preset produces, named once so analytics and reports can
 * read them without re-deriving them from labels.
 */
export const OUTBOUND_KEYS = {
  whoAnswered:           "whoAnswered",
  reachedDecisionMaker:  "reachedDecisionMaker",
  contactName:           "contactName",
  contactRole:           "contactRole",
  interestLevel:         "interestLevel",
  callbackRequested:     "callbackRequested",
  callbackWhen:          "callbackWhen",
  bestNumber:            "bestNumber",
  objection:             "objection",
  keyFacts:              "keyFacts",
  nextAction:            "nextAction",
  ivrOutcome:            "ivrOutcome",
} as const

// Keeps OUTBOUND_KEYS honest against the labels above. Runs once at module
// load; a mismatch is a programming error, not a runtime condition.
for (const f of OUTBOUND_PRESET_FIELDS) {
  const key = toKey(f.name)
  if (!Object.values(OUTBOUND_KEYS).includes(key as never)) {
    throw new Error(`extraction-presets: field "${f.name}" produces key "${key}" which OUTBOUND_KEYS does not list`)
  }
}

export type ExtractionPresetId = "outbound-cold-call"

export const EXTRACTION_PRESETS: {
  id: ExtractionPresetId
  label: string
  description: string
  schema: string
}[] = [
  {
    id: "outbound-cold-call",
    label: "Outbound cold call",
    description:
      "Who answered, whether you reached the decision-maker, interest, callbacks, objections, and what the phone menu did. " +
      "This is what campaign analytics and the downloadable report read from.",
    schema: OUTBOUND_PRESET_SCHEMA,
  },
]
