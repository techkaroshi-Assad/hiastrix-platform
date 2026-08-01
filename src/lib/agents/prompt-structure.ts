/**
 * Whether a prompt is fit to go live — structure, not subject matter.
 *
 * `prompt-check.ts` answers "what did you set up that won't happen?". This
 * answers a different question that turned out to matter just as much: *is this
 * prompt in a state anybody should ship?*
 *
 * ── The failure this exists for ────────────────────────────────────────────
 *
 * A live agent's prompt was found carrying the same eleven-line block **four
 * times**. Nobody wrote it four times — the builder's "Add a line to the
 * prompt" button appended blindly, and each enabled tool offered its own nearly
 * identical block. Four presses, four copies.
 *
 * That is not cosmetic. Every duplicated line is paid for on every turn of
 * every call, and a model given the same instruction four times does not follow
 * it four times harder — repetition dilutes attention and makes the genuinely
 * important lines harder to pick out. The agent was worse *and* more expensive,
 * and nothing in the product said a word about it.
 *
 * ── Why blocking, not warning ──────────────────────────────────────────────
 *
 * The checker already existed. It warned. The agent went live anyway, because
 * a warning is a thing you scroll past. Some faults are matters of judgement
 * and belong as advice; a prompt containing four copies of one paragraph is not
 * one of them. Those become blockers, and the platform refuses to put the agent
 * on the air until they are gone.
 *
 * The bar for a blocker is deliberately high: it must be something nobody could
 * reasonably have intended. Anything arguable stays a warning, because a
 * platform that refuses to publish over a matter of taste is one people learn
 * to route around.
 *
 * Client-safe: pure string work.
 */

/* ── Normalising, so "the same thing" means the same thing ─────────────── */

/**
 * A line reduced to its content.
 *
 * Numbering is stripped because the repeated blocks arrived as `1. Check
 * whether…` every time, and a comparison that respects numbering would call
 * four identical lists four different lists. Punctuation and case go for the
 * same reason: the model does not care and neither should the comparison.
 */
export function normaliseLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Paragraphs, as a person would see them. */
function blocksOf(prompt: string): string[] {
  return prompt
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean)
}

/** Meaningful lines — anything with actual words in it. */
function linesOf(prompt: string): { raw: string; key: string }[] {
  return prompt
    .split("\n")
    .map(raw => ({ raw: raw.trim(), key: normaliseLine(raw) }))
    // Four characters, so a stray "ok" or a divider is not counted as an
    // instruction somebody repeated.
    .filter(l => l.key.length >= 4)
}

/* ── What we found ─────────────────────────────────────────────────────── */

export type StructureIssue = {
  id: string
  /** Blockers stop the agent going live. Warnings are advice. */
  blocking: boolean
  title: string
  detail: string
  /** How many times the offending thing appears, where that is the point. */
  count?: number
  /** A short excerpt, so somebody can find it in their own prompt. */
  sample?: string
}

/**
 * Roughly what this prompt costs to carry.
 *
 * Four characters per token is the usual English approximation and is close
 * enough for the only decision it informs: is this prompt obviously too long.
 * A precise tokeniser would be a dependency, a bundle, and a false sense of
 * accuracy about a number that only needs an order of magnitude.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.trim().length / 4)
}

/** Past here a prompt is long enough to be worth questioning. */
const LONG_TOKENS = 1500
/** And past here it is long enough to hurt on every turn. */
const VERY_LONG_TOKENS = 3000

/**
 * Instructions that cannot both be obeyed.
 *
 * The naive version of this fired on its own evidence. "Never quote prices"
 * contains the phrase "quote prices", so a rule looking for a prohibition and a
 * requirement found both in the same five words and reported a contradiction in
 * a prompt that was perfectly clear. A checker that does that to a correct
 * prompt teaches people to ignore it, which costs more than the check is worth.
 *
 * So a contradiction now requires the *same topic* to appear in one sentence
 * that negates it and another that does not. The sentence is the unit, because
 * negation does not carry across a full stop.
 *
 * A short list on purpose. Each entry is a pair somebody has actually written
 * by accident, usually by pasting advice on top of a template. Inventing
 * cleverer detection would produce confident nonsense about coherent prompts.
 */
const NEGATION = /\b(?:never|not|n't|avoid|refrain|without|no)\b/i

const CONTRADICTIONS: { id: string; topic: RegExp; detail: string }[] = [
  {
    id: "price",
    topic: /\b(?:price|pricing|prices|quote a cost|how much it costs)\b/i,
    detail: "One sentence forbids discussing price and another asks for it. The agent will pick one, and not necessarily the same one each call.",
  },
  {
    id: "transfer",
    topic: /\btransfer(?:ring)?\b.{0,20}\b(?:call|caller|them|through)\b/i,
    detail: "The prompt both forbids and requires transferring the call.",
  },
  {
    id: "identify",
    topic: /\byou(?:'re| are)?\s+(?:an?\s+)?(?:ai|bot|robot|virtual assistant)\b/i,
    detail: "One sentence tells the agent to hide that it is an AI and another tells it to say so.",
  },
]

/** Sentences, roughly — enough that negation does not leak across a full stop. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Is this mention of the topic a prohibition?
 *
 * Only the words *before* the topic count. English puts the negation first —
 * "never quote a price" — and a sentence-wide search reads
 *
 *   "tell them the price straight away so they are not left guessing"
 *
 * as a prohibition because of a "not" that belongs to a different clause
 * entirely. That mistake turns a real contradiction into silence, which is the
 * expensive direction to be wrong in.
 */
function isProhibition(sentence: string, topic: RegExp): boolean {
  const m = topic.exec(sentence)
  if (!m) return false

  // A short run-up. Long enough for "you should never, under any circumstances,
  // quote a price", short enough not to reach the previous clause.
  const before = sentence.slice(Math.max(0, m.index - 60), m.index)
  return NEGATION.test(before)
}

/* ── The check ─────────────────────────────────────────────────────────── */

export function checkStructure(prompt: string): StructureIssue[] {
  const issues: StructureIssue[] = []
  const text = prompt ?? ""
  if (!text.trim()) return issues

  /* ── Whole paragraphs, repeated ──────────────────────────────────── */

  const blocks = blocksOf(text)
  const byBlock = new Map<string, { count: number; sample: string }>()

  for (const block of blocks) {
    // Compared line by line rather than as one string, so a block that differs
    // only in numbering or a trailing full stop still counts as the same block.
    const key = block.split("\n").map(normaliseLine).filter(Boolean).join("\n")
    if (key.length < 40) continue          // too small to be a "section"

    const seen = byBlock.get(key)
    if (seen) seen.count++
    else byBlock.set(key, { count: 1, sample: block.split("\n")[0] ?? "" })
  }

  for (const [, v] of byBlock) {
    if (v.count < 2) continue
    issues.push({
      id: `duplicate-block:${v.sample.slice(0, 24)}`,
      blocking: true,
      title: `The same section appears ${v.count} times`,
      detail:
        "Every copy is sent on every turn of every call, so you pay for all of them — and repeating an instruction does not make the agent follow it harder. It makes the lines that matter harder to pick out.",
      count: v.count,
      sample: v.sample,
    })
  }

  /* ── Individual instructions, repeated ───────────────────────────── */

  const lines = linesOf(text)
  const byLine = new Map<string, { count: number; sample: string }>()

  for (const l of lines) {
    // Short lines repeat innocently — headings, "Be polite." Only lines long
    // enough to be an instruction are worth reporting.
    if (l.key.length < 25) continue
    const seen = byLine.get(l.key)
    if (seen) seen.count++
    else byLine.set(l.key, { count: 1, sample: l.raw })
  }

  const repeatedLines = [...byLine.values()].filter(v => v.count >= 2)

  // Reported as one finding, not thirty. A duplicated block produces a repeat
  // of every line inside it, and listing each one buries the point.
  if (repeatedLines.length > 0 && !issues.some(i => i.id.startsWith("duplicate-block"))) {
    const worst = repeatedLines.sort((a, b) => b.count - a.count)[0]!
    issues.push({
      id: "repeated-lines",
      blocking: repeatedLines.length >= 3,
      title:
        repeatedLines.length === 1
          ? "An instruction is written twice"
          : `${repeatedLines.length} instructions are written more than once`,
      detail:
        "Saying the same thing twice costs twice and helps less than saying it once clearly.",
      count: worst.count,
      sample: worst.sample,
    })
  }

  /* ── Contradictions ──────────────────────────────────────────────── */

  const sentences = sentencesOf(text)

  for (const c of CONTRADICTIONS) {
    const mentions = sentences.filter(s => c.topic.test(s))
    const forbids  = mentions.some(s => isProhibition(s, c.topic))
    const requires = mentions.some(s => !isProhibition(s, c.topic))

    if (forbids && requires) {
      issues.push({
        id: `contradiction:${c.id}`,
        blocking: false,
        title: "Two instructions contradict each other",
        detail: c.detail,
        sample: mentions.find(s => !isProhibition(s, c.topic)),
      })
    }
  }

  /* ── Placeholders left in ────────────────────────────────────────── */

  const placeholder = /\[[A-Z][A-Z\s_/-]{2,}\]|\{\{\s*[A-Z_]{3,}\s*\}\}|<[A-Z][A-Z\s_]{2,}>/.exec(text)
  if (placeholder) {
    issues.push({
      id: "placeholder",
      blocking: true,
      title: "A template placeholder is still in the prompt",
      detail: `The agent will read “${placeholder[0]}” out loud, exactly as written.`,
      sample: placeholder[0],
    })
  }

  /* ── Length ──────────────────────────────────────────────────────── */

  const tokens = approxTokens(text)
  if (tokens >= VERY_LONG_TOKENS) {
    issues.push({
      id: "very-long",
      blocking: false,
      title: "This prompt is very long",
      detail:
        "It is carried on every turn of every call, so it costs on every turn — and past a point more instruction makes an agent less predictable, not more. Look for anything said twice.",
      count: tokens,
    })
  } else if (tokens >= LONG_TOKENS) {
    issues.push({
      id: "long",
      blocking: false,
      title: "This prompt is getting long",
      detail:
        "Worth a read through for anything repeated or no longer true. Every line is sent on every turn.",
      count: tokens,
    })
  }

  return issues
}

/* ── Tidying ───────────────────────────────────────────────────────────── */

export type TidyResult = {
  prompt: string
  /** What was taken out, for showing before anything is applied. */
  removedBlocks: string[]
  removedLines: string[]
  changed: boolean
}

/**
 * Remove what is duplicated, and nothing else.
 *
 * Deliberately conservative. It does not reorder, rewrite, shorten or improve
 * anybody's wording — it deletes second and subsequent copies of things already
 * present, keeping the first occurrence in place. That is the one edit that is
 * unambiguously safe, because the resulting prompt says exactly what the
 * original said.
 *
 * The result is returned rather than applied. A prompt is the tenant's own
 * writing and the platform does not get to rewrite it behind their back — the
 * editor shows what would go and lets them decide.
 */
export function tidyPrompt(prompt: string): TidyResult {
  const text = prompt ?? ""
  if (!text.trim()) {
    return { prompt: text, removedBlocks: [], removedLines: [], changed: false }
  }

  const removedBlocks: string[] = []
  const seenBlocks = new Set<string>()
  const keptBlocks: string[] = []

  for (const block of blocksOf(text)) {
    const key = block.split("\n").map(normaliseLine).filter(Boolean).join("\n")

    if (key.length >= 40 && seenBlocks.has(key)) {
      removedBlocks.push(block.split("\n")[0] ?? block.slice(0, 60))
      continue
    }
    if (key.length >= 40) seenBlocks.add(key)
    keptBlocks.push(block)
  }

  // Then repeated single lines *within* what is left, which catches the case
  // where somebody pasted one instruction into two different sections.
  const removedLines: string[] = []
  const seenLines = new Set<string>()

  const cleaned = keptBlocks.map(block =>
    block
      .split("\n")
      .filter(raw => {
        const key = normaliseLine(raw)
        if (key.length < 25) return true
        if (seenLines.has(key)) {
          removedLines.push(raw.trim())
          return false
        }
        seenLines.add(key)
        return true
      })
      .join("\n")
      .trim()
  ).filter(Boolean)

  const next = cleaned.join("\n\n")

  return {
    prompt: next,
    removedBlocks,
    removedLines,
    changed: next.trim() !== text.trim(),
  }
}

/**
 * Is this block already here?
 *
 * Used by the builder's "add this to the prompt" button, which used to append
 * blindly — press it four times and the prompt carries four copies. Comparing
 * on normalised lines rather than exact text means a block already present in
 * slightly different punctuation is still recognised.
 */
export function promptContains(prompt: string, block: string): boolean {
  const haystack = new Set(linesOf(prompt).map(l => l.key))
  const needles = linesOf(block).map(l => l.key)
  if (!needles.length) return false

  const found = needles.filter(k => haystack.has(k)).length
  // Most of it, not all: a block re-offered after somebody edited one line of
  // it is still the same block, and re-adding it is still wrong.
  return found / needles.length >= 0.8
}

/* ── Applying a template over writing somebody already did ─────────────── */

/**
 * Are these two pieces of text the same thing?
 *
 * Normalised, so a template somebody has only reformatted still counts as
 * unedited. Whitespace, numbering and trailing punctuation are not authorship.
 */
export function sameText(a: string, b: string): boolean {
  const key = (t: string) =>
    linesOf(t).map(l => l.key).join("\n")
  return key(a) === key(b)
}

/** Roughly how much writing is here — the unit a person recognises. */
function words(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

export type Overwrite = {
  field: "systemPrompt" | "firstMessage" | "tools"
  /** What goes. */
  label: string
  /** How much of it, in the terms the person wrote it in. */
  detail: string
}

/**
 * What applying this template would destroy.
 *
 * A template replaces the instructions, the greeting and the enabled actions
 * outright. That is correct on an empty agent and quietly destructive on one
 * somebody has spent an hour writing — the previous version simply overwrote
 * it, with no warning and no undo, and the tenant's own words were gone.
 *
 * The distinction that matters is *whose* writing is in the box. Text that is
 * still byte-for-byte one of our own templates is ours: switching from one
 * template to another loses nothing and should not ask. Text that is theirs —
 * blank slate filled in, or a template they then edited — is theirs, and
 * replacing it is a decision they get to make with the facts in front of them.
 *
 * Returning an empty array means "apply it, say nothing". Anything else is
 * shown before a single character changes.
 *
 * @param known every template's own text, so an unedited one is recognised
 */
export function templateOverwrites(
  current:  { systemPrompt: string; firstMessage: string; toolLabels: string[] },
  incoming: { systemPrompt: string; firstMessage: string; toolLabels: string[] },
  known: { systemPrompt: string; firstMessage: string }[]
): Overwrite[] {
  const theirs = (text: string, pick: (k: { systemPrompt: string; firstMessage: string }) => string) => {
    if (!text.trim()) return false                       // nothing there
    if (known.some(k => sameText(text, pick(k)))) return false  // ours, untouched
    return true
  }

  const promptMine = theirs(current.systemPrompt, k => k.systemPrompt)
                     && !sameText(current.systemPrompt, incoming.systemPrompt)
  const firstMine  = theirs(current.firstMessage, k => k.firstMessage)
                     && !sameText(current.firstMessage, incoming.firstMessage)

  // Actions alone are not worth a confirmation — they are two clicks to put
  // back, and every template switch changes them. They are listed only once we
  // are already stopping for something that cannot be clicked back.
  if (!promptMine && !firstMine) return []

  const out: Overwrite[] = []

  if (promptMine) {
    out.push({
      field: "systemPrompt",
      label: "Your instructions",
      detail: `${words(current.systemPrompt).toLocaleString()} words, about ${approxTokens(current.systemPrompt).toLocaleString()} tokens`,
    })
  }

  if (firstMine) {
    out.push({
      field: "firstMessage",
      label: "Your greeting",
      detail: current.firstMessage.trim().slice(0, 80),
    })
  }

  const dropped = current.toolLabels.filter(l => !incoming.toolLabels.includes(l))
  if (dropped.length) {
    out.push({
      field: "tools",
      label: dropped.length === 1 ? "An action you switched on" : `${dropped.length} actions you switched on`,
      detail: dropped.join(" · "),
    })
  }

  return out
}
