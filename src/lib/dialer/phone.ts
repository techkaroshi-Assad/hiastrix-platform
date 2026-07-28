/**
 * Turning what people actually type into something dialable.
 *
 * Client-safe: string handling only, no dependency.
 *
 * ── WHY THIS IS HAND-WRITTEN ──────────────────────────────────────────
 *
 * A full phone-number library carries a metadata table for every country on
 * earth — several hundred kilobytes — to answer questions this platform does
 * not ask. We do not need to know that a number is a mobile in Lagos or a
 * landline in Lyon. We need to know whether it is plausibly dialable and to get
 * it into one consistent shape so the same person is not queued twice under two
 * spellings.
 *
 * So the rule is deliberately narrow and honest about it: normalise the shapes
 * people really paste into spreadsheets, and reject anything ambiguous rather
 * than guessing. A number rejected at import is a row the tenant can see and
 * fix. A number guessed wrong at import is a stranger's phone ringing.
 */

export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: string }

/** The same rule the test-call route already applies. E.164, 8–15 digits. */
const E164 = /^\+[1-9]\d{7,14}$/

/**
 * Everything that is punctuation to a human and noise to a dialer. Extension
 * markers are handled separately — see below.
 */
const PUNCTUATION = /[\s().\-–—/\\[\]]/g

/**
 * Normalise one number.
 *
 * `defaultCountryCode` is the tenant's own dialling code, used only for numbers
 * written in national form. It is never used to rescue something that already
 * carries a country code.
 */
export function toE164(raw: string, defaultCountryCode = "1"): PhoneResult {
  if (typeof raw !== "string") return { ok: false, reason: "Not a number." }

  let s = raw.trim()
  if (!s) return { ok: false, reason: "Empty." }

  /*
   * Extensions are dropped, not rejected.
   *
   * "+1 313 555 0100 x204" is a real, dialable number with a routing hint
   * attached. An automated call cannot navigate a phone tree anyway, so the
   * extension is useless to us — but the number in front of it is fine, and
   * throwing the whole row away over it would lose real leads.
   */
  s = s.replace(/\s*(?:ext|x|extn|extension)\.?\s*\d+\s*$/i, "")

  // "00" is how much of the world writes "+".
  s = s.replace(/^00/, "+")

  const hadPlus = s.startsWith("+")
  s = s.replace(PUNCTUATION, "")
  if (hadPlus && !s.startsWith("+")) s = `+${s}`

  if (/[^\d+]/.test(s)) {
    return { ok: false, reason: "Contains characters that aren't part of a phone number." }
  }
  if (s.indexOf("+") > 0 || (s.match(/\+/g) ?? []).length > 1) {
    return { ok: false, reason: "The + must be at the start, and there can only be one." }
  }

  const digits = s.replace("+", "")
  if (!digits) return { ok: false, reason: "No digits." }

  if (hadPlus) {
    const e164 = `+${digits}`
    return E164.test(e164)
      ? { ok: true, e164 }
      : { ok: false, reason: "Not a valid international number." }
  }

  const cc = defaultCountryCode.replace(/\D/g, "") || "1"

  /*
   * A leading 0 is a national trunk prefix nearly everywhere that uses one, and
   * it is never part of the international number. "07700 900123" in the UK is
   * "+44 7700 900123".
   */
  const national = digits.replace(/^0+/, "")
  if (!national) return { ok: false, reason: "No digits." }

  /*
   * A local number with the area code left off.
   *
   * "555-0100" passes the E.164 length test once a country code is bolted on —
   * eight digits is inside the range — but +1 555 0100 is not this person's
   * phone number, it is a different person's. Every country that has national
   * numbering uses at least eight digits nationally, so anything shorter is a
   * fragment and is refused rather than completed with a guess.
   */
  if (national.length < 8) {
    return {
      ok: false,
      reason: "Too short — include the area code, or write the number in full with its country code.",
    }
  }

  /*
   * Already carrying its own country code, written without the plus.
   *
   * Only trusted when the length also works out — "13135550100" is eleven
   * digits starting with the tenant's code and is almost certainly a full US
   * number, whereas "3135550100" is ten and is almost certainly national.
   * Anything ambiguous falls through to prefixing, which is the safer guess.
   */
  const withCc = national.startsWith(cc) && national.length === cc.length + 10
    ? `+${national}`
    : `+${cc}${national}`

  if (!E164.test(withCc)) {
    return {
      ok: false,
      reason: `Doesn't look like a complete number. Write it in full, e.g. +${cc}5551234567.`,
    }
  }

  return { ok: true, e164: withCc }
}

/**
 * Group by country code, purely so a failed import can say something useful
 * ("18 of these look like UK numbers — is your default dialling code right?").
 */
export function countryCodeOf(e164: string): string {
  const d = e164.replace(/\D/g, "")
  // North America, then the small set of one-digit and common two-digit codes.
  if (d.startsWith("1")) return "1"
  if (d.startsWith("7")) return "7"
  return d.slice(0, 2)
}
