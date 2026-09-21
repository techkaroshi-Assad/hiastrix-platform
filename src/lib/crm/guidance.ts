/**
 * Turning capabilities into behaviour.
 *
 * Switching a tool on tells the agent what it *can* do. It says nothing about
 * when, or in what order — and the wrong order is not a cosmetic problem: create
 * before lookup makes duplicate contacts, and searching for someone you just
 * created finds nothing for about seven seconds and invites making them twice.
 *
 * Two layers, deliberately separate.
 *
 *   enforcedRules()  — appended to every agent's prompt when we build the
 *                      assistant. Short, mechanical, and not the tenant's to
 *                      delete, because breaking these corrupts their data.
 *
 *   suggestedFlow()  — a draft the builder offers to paste into their prompt.
 *                      Conversational, theirs to rewrite or ignore.
 *
 * Client-safe: pure string building, no env, no imports beyond the tool types.
 */

import type { AgentTool, AgentToolType } from "@/lib/vapi/tools"

const has = (tools: AgentTool[], type: AgentToolType) => tools.some(t => t.type === type)
const anyCrm = (tools: AgentTool[]) => tools.some(t => t.type.startsWith("crm."))

/* ── What the agent knows at the moment it picks up ────────────────────── */

/**
 * The date, the time, and who is on the line.
 *
 * A language model has no clock and no caller display. Left unaided it invents
 * both, and it does not invent them plausibly: on a live call placed on 31 July
 * 2026 an agent asked for availability between 3 and 7 **June 2024**, was
 * correctly told there was nothing free, and spent two minutes offering the
 * caller weeks that had already happened. On the same call it asked the caller
 * to spell out an email — because nobody had told it we already held their
 * number — and speech-to-text produced two different addresses across two
 * calls, so the lookup missed and a duplicate contact was created each time.
 *
 * Both are one-line fixes, and both have to be resolved when the call happens
 * rather than when the agent is saved. These are Vapi's own template variables,
 * substituted at call time: bake a real date in here and the agent believes
 * whatever day it was last edited, which is a worse bug than the one being
 * fixed because it degrades silently over months.
 *
 * `{{customer.number}}` is the caller's number on an inbound call and the
 * number dialled on an outbound one — in both cases the other party, which is
 * what we want. It can be empty when a caller withholds their number, so the
 * wording never promises it is there.
 */
function nowBlock(timeZone: string): string {
  const day  = `{{"now" | date: "%A, %B %d, %Y", "${timeZone}"}}`
  const time = `{{"now" | date: "%I:%M %p", "${timeZone}"}}`

  return [
    `Today is ${day}. The time is ${time} (${timeZone}).`,
    "Work out every date the caller mentions from that — \"tomorrow\", \"next week\", \"the 14th\" — and never guess a year.",
    "The other party's number on this call is {{customer.number}}. That line is blank only if they withheld it.",
  ]
    .map(l => `- ${l}`)
    .join("\n")
}

/* ── Everything you emit is spoken ──────────────────────────────────────── */

/**
 * The rule that had to exist before any of the others were safe to give.
 *
 * ── THE FAILURE ───────────────────────────────────────────────────────
 *
 * From Kaizen's own transcripts, said out loud, down the phone, to a real
 * person or a real menu:
 *
 *   "Since this menu isn't specific to billing or claims for the practice
 *    itself, and it seems to direct patients based on last names, I'll hang up
 *    now and note this as a central line or unrelated menu. Letting the call go
 *    further would not be productive. Using the end call function now. Thanks
 *    for your time. Have a good day."
 *
 *   "It seems this is a central number for a larger system rather than the
 *    specific practice's billing department. I will end the call now. Thank
 *    you. Using the end call function to hang up."
 *
 *   "1 moment. Since the phone menu didn't provide a billing option, I'll press
 *    1 to speak with a—"
 *
 * 48 of 506 calls in three weeks — roughly one in ten — contain the agent
 * reading its own deliberation aloud. Not the prompt text itself: a search for
 * verbatim instruction strings across 1,845 agent turns found none. What leaks
 * is the *reasoning*, in the model's own words, reconstructed live from the
 * instructions it was given.
 *
 * ── WHY ───────────────────────────────────────────────────────────────
 *
 * On a phone call there is exactly one output channel and it goes to a
 * loudspeaker. The model has nowhere to think. Every block below this one asks
 * it to make a judgement — is this menu relevant, has the caller said goodbye,
 * is this the third loop — in second-person imperative, which is also the
 * register a person uses when narrating. Nothing anywhere told it that the
 * working-out is not part of the answer, so it wrote the working-out, and the
 * working-out was spoken.
 *
 * Note what the model did with the one ban that did exist. `ivrLines` said
 * never say the words "pressing" or "press" *to a phone menu* — so it said
 * "I'll press 1" while addressing itself, and "Using the end call function
 * now" instead of "pressing". A narrow ban teaches paraphrase. This one is
 * stated as a property of the channel rather than a list of forbidden words,
 * because the model cannot route around a fact about where its output goes.
 *
 * ── WHY IT IS NOT A TOGGLE ────────────────────────────────────────────
 *
 * Every behaviour in this platform is the tenant's to configure. This is not a
 * behaviour, it is a fact about the medium: there is no setting under which a
 * tenant wants their agent announcing that it is about to hang up and what it
 * is recording about the caller. It sits with the honesty rule and "never read
 * an id aloud" — the short list of things that are wrong on every call, for
 * every tenant, in every configuration. It is first in the prompt because
 * everything after it is an instruction to decide something.
 */
const DELIVERY_LINES = [
  "Everything you produce on this call is spoken out loud to the other party the instant you produce it. There is no private channel, no scratchpad, and no way to think to yourself — if you would not say it to the person on the phone, do not write it at all.",
  "Never announce, explain or justify what you are about to do. Do not say what you are deciding, why, what you have concluded about this call, what you are about to press, that you are about to hang up, or what you are recording. Take the action and say only the words a real person would say in that moment.",
  "Never say the name of any function, tool or capability you have, in any form — not \"endCall\", not \"the end call function\", not \"dtmf\", and not a paraphrase like \"I'll press 1\" or \"I'm going to hang up now\". Acting and describing the action are different things; only the action is wanted.",
  "Never talk about the call, the other party or their company in the third person while you are still on the line, and never summarise or classify what has happened so far out loud. That belongs in your recap after the call, not in the call.",
]

/* ── Hanging up ─────────────────────────────────────────────────────────── */

/**
 * The provider gives every agent an `endCall` function now (see
 * lib/vapi/payload.ts) — a capability, not a behaviour, same as everything
 * else in this file. Without this block the model has a way to hang up and no
 * instruction to ever use it, which is indistinguishable from not having it:
 * the caller says goodbye and the agent just keeps talking.
 *
 * The middle line is the cold-calling nuance directly: one objection is not a
 * goodbye, and an agent that hangs up the instant someone hesitates is worse
 * than one that never hangs up at all.
 */
const CALL_END_LINES = [
  // The mechanical fact still has to be stated — a model that does not know
  // saying goodbye leaves the line open will sit there until the timeout. What
  // changed is the second half: the capability is named once, here, as
  // something to invoke, and immediately ruled out as something to mention.
  // Without that the name simply became part of the agent's spoken vocabulary
  // ("Using the end call function now", twice, on real calls).
  "You have an endCall function — invoke it to actually hang up. Saying goodbye out loud does not end the call by itself. Invoke it silently: never say its name, never say you are invoking it, never announce that you are ending the call.",
  "End the call once the caller says goodbye, makes clear they have nothing further to add, or asks you to stop calling or leave them alone. Give a brief, natural sign-off first — \"thanks for your time, have a good day\" and nothing more — then hang up. Never mid-sentence, and never right after you've just asked them something.",
  "A single objection or \"I'm not interested\" is not the same as goodbye — respond to it once and keep the conversation going. Only end the call if they repeat that they're not interested, say goodbye, or explicitly ask you to stop.",
]

/**
 * Two failure modes that show up as the same thing on the caller's end: the
 * conversation stops moving forward. One live test looped a caller through
 * "may I ask your name" five times in a row, past two outright refusals,
 * ignoring every question the caller actually asked; a rough connection on
 * the same call had the assistant re-introduce itself and re-open with
 * "good morning" mid-conversation, more than once, as if the call had just
 * started.
 *
 * Both are cheap to stop at the instruction level regardless of why the
 * model started doing it — a garbled turn, an overlapping interruption, a
 * tenant's own prompt asking for the same field without a fallback — so
 * this is unconditional, the same as the call-ending block above.
 */
const CONVERSATION_LINES = [
  "You already greeted the caller once, at the very start of this call. Never repeat your opening greeting or reintroduce yourself again later in the same call — not even if the audio glitches or you're unsure what was just said. Just continue naturally from wherever the conversation actually is.",
  "Never ask for the same piece of information more than twice. If the caller doesn't answer, deflects, or declines after two asks, drop it for the rest of the call and keep helping them without it.",
  "Answer the question the caller actually just asked before you ask them anything of your own. If you don't have the information to answer it, say so plainly rather than steering back to what you wanted to ask.",
]

/* ── Phone menus ────────────────────────────────────────────────────────── */

/**
 * What the agent is told when it has a keypad (`ivrNavigationEnabled`).
 *
 * The failure this exists for, from Kaizen's campaign transcripts: with no
 * keypad the model said "Pressing 4 for billing", the menu replayed, it said
 * "Pressing 4 again", "Pressing 8 once more", "Pressing 0" — nothing was ever
 * sent, and 44 of those calls ran to the silence timeout. The dtmf tool fixes
 * the capability; these lines fix the behaviour, and every one of them maps
 * to something Vapi's own IVR guide recommends: wait for the whole menu,
 * stay silent while waiting, put pauses between digits, slow down on retry,
 * escalate to an operator, and give up after a bounded number of rounds
 * rather than sitting through a loop.
 *
 * The target and attempt count are the tenant's, not ours — a billing
 * company wants "billing", a recruiter wants "HR", and how patient to be is
 * a cost decision.
 */
export type IvrRules = { target: string; maxAttempts: number }

/** The one place the config's three IVR fields become an `ivr` option. */
export function ivrRulesFrom(config: {
  ivrNavigationEnabled: boolean
  ivrTarget: string
  ivrMaxAttempts: number
}): IvrRules | null {
  return config.ivrNavigationEnabled
    ? { target: config.ivrTarget, maxAttempts: config.ivrMaxAttempts }
    : null
}

function ivrLines(ivr: IvrRules): string[] {
  const target = ivr.target.trim() || "a live operator"
  const n = Math.max(1, Math.min(6, Math.round(ivr.maxAttempts)))
  return [
    // A menu is the worst case for narration: there is no human to be
    // embarrassed in front of, so the model relaxes into thinking out loud,
    // and every line below asks it to make a judgement. Each one therefore
    // carries its own silence clause rather than relying on the block above.
    `You have a dtmf function that presses keypad digits. Saying "pressing 2" out loud does nothing — if you want to press a key, you must invoke dtmf. Pressing is silent: produce no speech at all in the same turn, and never say the words "press" or "pressing" at any point in the call, to a menu or to a person.`,
    `If an automated phone menu answers instead of a person, stop your opening pitch and listen. Wait until every option has been read out before choosing — do not respond partway through. While you are listening, reply with a single space so nothing is spoken.`,
    `Choose the option that gets you to ${target}. If none of the options fit, choose 0 or the option for the operator, front desk, or "all other calls". Send the digit with dtmf using a leading pause, e.g. keys "w2". Make that choice silently — never say which option you picked, why you picked it, or what you think this menu is for.`,
    `If the same menu plays again after you pressed, the tone was missed. Send the same option once more, slower: "W2". If it plays a third time, try 0. If a menu says "press 1 or stay on the line", stay on the line — reply with a space and wait. Say nothing through any of this.`,
    `You get at most ${n} rounds of menu before you give up. If you still have not reached a person by then, or the menu is clearly looping, hang up immediately and in silence. Do not wait for silence on the line, do not explain that the menu was not relevant, do not say what kind of number you think you reached, and do not say goodbye — there is nobody there to hear it. Hanging up is the correct outcome and it needs no words.`,
    `The moment a real person answers, continue with your normal conversation from your greeting onward. Never mention that you navigated a menu or pressed anything.`,
  ]
}

/* ── The non-negotiable part ───────────────────────────────────────────── */

/**
 * Only the rules that prevent damage, and only those relevant to the tools
 * actually switched on. Every extra line here dilutes the tenant's own prompt,
 * so this stays short on purpose.
 */
export function enforcedRules(
  tools: AgentTool[],
  opts: { timeZone?: string; ivr?: IvrRules | null } = {}
): string {
  const timeZone = opts.timeZone?.trim() || "UTC"

  /*
   * First, and unconditional.
   *
   * Order matters here in a way it does not for the rest of the file. Every
   * block after this one hands the model a judgement to make, and a judgement
   * made without knowing the output is live gets spoken. Stating the property
   * of the channel before the first "decide whether…" is what makes the rest
   * of these instructions safe to give.
   */
  const delivery = `\n\n---\nHow you are heard (set by Hi-Astrix):\n${DELIVERY_LINES.map(l => `- ${l}`).join("\n")}`

  // The date and caller block goes to every agent, CRM or not. An agent with no
  // CRM tools at all still gets asked what day Thursday falls on.
  const context = `\n\n---\nRight now (set by Hi-Astrix):\n${nowBlock(timeZone)}`

  // Same story for ending the call: every agent gets the endCall function
  // now, so every agent needs to be told when to use it — not just the ones
  // with CRM tools switched on.
  const callControl = `\n\n---\nEnding the call (set by Hi-Astrix):\n${CALL_END_LINES.map(l => `- ${l}`).join("\n")}`

  // And this one has nothing to do with CRM tools at all — it is about the
  // model not looping on itself, which every agent can do regardless of
  // what it's connected to.
  const conversation = `\n\n---\nStaying on track (set by Hi-Astrix):\n${CONVERSATION_LINES.map(l => `- ${l}`).join("\n")}`

  // Only when the keypad is actually attached — telling a model to call a
  // function it does not have is exactly the narrated-but-not-done failure
  // this whole block exists to prevent.
  const ivr = opts.ivr
    ? `\n\n---\nPhone menus (set by Hi-Astrix):\n${ivrLines(opts.ivr).map(l => `- ${l}`).join("\n")}`
    : ""

  if (!anyCrm(tools)) return delivery + context + callControl + conversation + ivr

  const lines: string[] = []

  if (has(tools, "crm.contact.find")) {
    lines.push(
      // Named explicitly rather than left as "their phone number", because the
      // agent that failed did have a lookup rule — it just had no number, so it
      // asked, and an email read aloud is the least reliable identifier there is.
      //
      // This is also the whole answer, for now, to "does the agent know who's
      // calling" on an inbound call: there is no per-caller briefing before
      // the phone even rings — that would mean every number resolving its
      // assistant dynamically per call rather than the fixed assignment the
      // on/off switch in lib/agents/availability.ts depends on, which is a
      // bigger and separately-verified change. Looked up in the first seconds
      // of the call, before anything substantive is said, is the safe version
      // of the same outcome with none of that risk.
      "Look the caller up by the number above before you say anything beyond your greeting. Only ask for a phone number or an email address if that number is blank, or if it finds nobody.",
      "If the lookup finds them, that is who you are speaking with — greet them as an existing contact and use whatever it tells you about them. Do not claim anything about them beyond what the lookup actually returned."
    )
  }
  if (has(tools, "crm.contact.create")) {
    lines.push(
      "Only create a contact when the lookup found nobody. Once you create one, use the contact id from that reply for the rest of the call — do not look them up again, and never create the same person twice."
    )
  }
  if (has(tools, "crm.tag.add") || has(tools, "crm.opportunity.stage") || has(tools, "crm.opportunity.create")) {
    lines.push(
      "Use only the exact stage and tag names you are offered. If one is refused, the reply lists the real options — pick from those rather than inventing a name."
    )
  }
  if (has(tools, "crm.appointment.book")) {
    lines.push(
      "Only offer times the availability tool returned, and book using that exact value. Never promise a slot you have not checked."
    )
  }

  /*
   * The honesty rule.
   *
   * On one live call the agent told the caller "I have noted your request for a
   * callback" without ever calling the note tool, and wrote a note saying an
   * appointment was booked for 4pm when no booking tool had been called at all.
   * A model narrates what it intended as though it had happened, and on a phone
   * call nobody can see that it did not — the caller hangs up believing they
   * have an appointment.
   */
  lines.push(
    "Never tell the caller something has been done — booked, noted, tagged, updated, created — unless the tool you used has replied saying it was done. If a tool fails or you have not called it, say you will pass it on instead."
  )

  lines.push("Never read an id, a reference or a system message aloud to the caller.")

  return `${delivery}${context}${callControl}${conversation}${ivr}\n\nHow to use the CRM (set by Hi-Astrix):\n${lines.map(l => `- ${l}`).join("\n")}`
}

/* ── The editable draft ────────────────────────────────────────────────── */

const STEP: Partial<Record<AgentToolType, string>> = {
  "crm.contact.find":            "Check whether they are already a customer.",
  "crm.contact.create":          "If they are new, take their name and the best number to reach them on, and add them.",
  "crm.contact.update":          "If anything they tell you differs from what is on file, correct it.",
  "crm.contact.field.set":       "Record their answers against the right fields as you go.",
  "crm.appointment.availability":"Check what is genuinely free before you offer any times.",
  "crm.appointment.book":        "Book the slot they choose and read the day and time back to confirm.",
  "crm.opportunity.create":      "If they are genuinely interested, open a deal for them.",
  "crm.opportunity.stage":       "Move their existing deal to reflect how the call actually went.",
  "crm.note.add":                "Before you finish, write a short note covering what they wanted and what you agreed.",
  "crm.tag.add":                 "Tag the outcome so the follow-up runs itself.",
  "crm.tag.remove":              "Clear any tag that no longer describes them.",
}

/** The order a real call happens in, not the order the toggles appear in. */
const ORDER: AgentToolType[] = [
  "crm.contact.find",
  "crm.contact.create",
  "crm.contact.update",
  "crm.contact.field.set",
  "crm.appointment.availability",
  "crm.appointment.book",
  "crm.opportunity.create",
  "crm.opportunity.stage",
  "crm.note.add",
  "crm.tag.add",
  "crm.tag.remove",
]

export function suggestedFlow(tools: AgentTool[]): string {
  const steps = ORDER.filter(type => has(tools, type))
    .map(type => STEP[type])
    .filter((s): s is string => Boolean(s))

  if (!steps.length) return ""

  return [
    "During the call:",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Keep it conversational — ask one thing at a time, and never mention that you are updating a system.",
  ].join("\n")
}
