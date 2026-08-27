/**
 * Reading a CSV the way spreadsheets actually write them.
 *
 * Client-safe, no dependency. Runs in the browser so a large file is parsed on
 * the machine that already has it, and only clean rows cross the network — which
 * also keeps every request in this codebase JSON, with no multipart route.
 *
 * ── WHY NOT `split(",")` ──────────────────────────────────────────────
 *
 * Because the first real customer list will contain a company called
 * "Smith, Jones & Co", and a naive split turns that one row into two, silently,
 * shifting every column after it. The phone number ends up in the name field and
 * the import either fails confusingly or dials nonsense.
 *
 * So this implements the quoting rules properly: fields may be quoted, quotes
 * inside a quoted field are doubled, and a quoted field may contain commas and
 * newlines. That is RFC 4180, and it is what Excel, Numbers and Google Sheets
 * all emit.
 */

export type ParsedCsv = {
  headers: string[]
  rows: string[][]
  /** Rows whose column count did not match the header. Reported, not dropped. */
  ragged: { line: number; got: number }[]
}

/** Excel writes a byte-order mark; left in place it becomes part of header one. */
const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

export function parseCsv(input: string, delimiter = ","): ParsedCsv {
  const text = stripBom(input)
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let i = 0

  const endField = () => { row.push(field); field = "" }
  const endRow = () => {
    endField()
    // A trailing newline produces one empty row; a blank line in the middle of a
    // file is almost always accidental. Neither is a lead.
    if (row.length > 1 || row[0] !== "") rows.push(row)
    row = []
  }

  while (i < text.length) {
    const c = text[i]

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }  // escaped quote
        quoted = false; i++; continue
      }
      field += c; i++; continue
    }

    if (c === '"' && field === "") { quoted = true; i++; continue }
    if (c === delimiter) { endField(); i++; continue }
    if (c === "\r") { i++; continue }
    if (c === "\n") { endRow(); i++; continue }

    field += c; i++
  }

  if (field !== "" || row.length) endRow()

  const headers = (rows.shift() ?? []).map(h => h.trim())
  const width = headers.length
  const ragged: { line: number; got: number }[] = []

  const clean = rows.filter((r, n) => {
    if (r.length === width) return true
    ragged.push({ line: n + 2, got: r.length })   // +2: 1-based, and past the header
    return false
  })

  return { headers, rows: clean, ragged }
}

/**
 * Guess which column is which.
 *
 * A guess, offered to the person for correction — never applied silently. The
 * cost of a wrong guess is dialling a customer number that was actually a fax
 * line, so the import screen shows what was matched and lets it be changed.
 */
export type ColumnGuess = {
  phone: number | null
  firstName: number | null
  lastName: number | null
  fullName: number | null
  email: number | null
  /** Kept apart from the personal-name fields on purpose — a lead is often a
   *  business, not a person, and the two get surfaced to the agent separately.
   *  See lib/crm/lead-context.ts. */
  business: number | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "")

const PHONE  = ["phone", "phonenumber", "mobile", "cell", "cellphone", "telephone",
                "tel", "number", "contactnumber", "primaryphone", "phone1"]
const FIRST  = ["firstname", "first", "fname", "givenname", "forename"]
const LAST   = ["lastname", "last", "lname", "surname", "familyname"]
const FULL   = ["name", "fullname", "contact", "contactname", "customer", "client"]
// No single letters, and nothing shorter than the substring pass will accept.
// An "e" here matched "Vehicle" and quietly imported a van as an email address.
const EMAIL  = ["email", "emailaddress", "mail"]
const BUSINESS = ["business", "businessname", "company", "companyname", "organization",
                  "organisation", "organizationname", "organisationname", "firm", "dba"]

/**
 * Two passes, and the order is load-bearing.
 *
 * Every exact match is taken first, across all the fields, before any substring
 * match is considered anywhere. Without that, "Full Name" is claimed by the
 * last-name matcher — because the normalised string "fullname" contains
 * "lname" — and the sheet ends up with a surname column and no name at all.
 * Substring matching is useful ("Mobile Phone", "Contact Email") and dangerous
 * in exactly this way, so it only ever gets what nothing matched exactly.
 *
 * A column is also claimed once. "Phone" cannot be both the phone and, by some
 * unlucky substring, the email.
 */
function pickAll(
  headers: string[],
  fields: Record<string, string[]>
): Record<string, number | null> {
  const n = headers.map(norm)
  const taken = new Set<number>()
  const out: Record<string, number | null> = {}

  for (const key of Object.keys(fields)) out[key] = null

  for (const [key, wanted] of Object.entries(fields)) {
    for (const w of wanted) {
      const i = n.indexOf(w)
      if (i !== -1 && !taken.has(i)) { out[key] = i; taken.add(i); break }
    }
  }

  /*
   * Substrings, and only ones long enough to mean something.
   *
   * Four characters minimum. Below that the matches are coincidences —
   * "Vehicle" contains "e", "Notes" contains "tel" if you squint — and a
   * coincidence here silently maps the wrong column, which is the failure mode
   * this whole function exists to avoid.
   */
  for (const [key, wanted] of Object.entries(fields)) {
    if (out[key] !== null) continue
    for (const w of wanted) {
      if (w.length < 4) continue
      const i = n.findIndex((h, idx) => !taken.has(idx) && h.includes(w))
      if (i !== -1) { out[key] = i; taken.add(i); break }
    }
  }

  return out
}

export function guessColumns(headers: string[]): ColumnGuess {
  // fullName is offered to the matcher before first/last so that a sheet whose
  // only name column is "Name" resolves to one field rather than being carved up.
  // A sheet with a real first/last pair matches those exactly, and fullName then
  // finds nothing left — which is the outcome we want.
  // `business` is offered to the matcher before `fullName` so a header like
  // "Business Name" cannot be stolen by fullName's own "name" substring —
  // the same trap the comment above describes for last-name-vs-full-name,
  // one substring pass earlier.
  const m = pickAll(headers, {
    phone: PHONE,
    email: EMAIL,
    firstName: FIRST,
    lastName: LAST,
    business: BUSINESS,
    fullName: FULL,
  })

  // If both halves of a pair were found, a stray fullName match is noise.
  const hasPair = m.firstName !== null && m.lastName !== null

  return {
    phone: m.phone,
    firstName: m.firstName,
    lastName: m.lastName,
    fullName: hasPair ? null : m.fullName,
    email: m.email,
    business: m.business,
  }
}

/** What the browser sends up, once the person has confirmed the mapping. */
export type ImportRow = {
  phone: string
  name?: string
  email?: string
  /** Everything else in the row, available to the agent's opening line. Carries
   *  a `business` key when that column was mapped — see lib/crm/lead-context.ts,
   *  which is what actually surfaces it to the agent as its own fact rather
   *  than an anonymous merge value. */
  fields?: Record<string, string>
}

export function toImportRows(parsed: ParsedCsv, map: ColumnGuess): ImportRow[] {
  const at = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim())
  const mapped = new Set(
    [map.phone, map.firstName, map.lastName, map.fullName, map.email, map.business]
      .filter((i): i is number => i !== null)
  )

  return parsed.rows.map(r => {
    const name = map.fullName !== null
      ? at(r, map.fullName)
      : [at(r, map.firstName), at(r, map.lastName)].filter(Boolean).join(" ")
    const business = at(r, map.business)

    // Unmapped columns ride along as merge values rather than being discarded —
    // "your quote for {{vehicle}}" is the whole point of importing a spreadsheet
    // rather than a list of numbers.
    const fields: Record<string, string> = {}
    if (business) fields.business = business
    parsed.headers.forEach((h, i) => {
      if (mapped.has(i)) return
      const v = (r[i] ?? "").trim()
      if (v) fields[norm(h) || `col${i}`] = v
    })

    return {
      phone: at(r, map.phone),
      ...(name ? { name } : {}),
      ...(at(r, map.email) ? { email: at(r, map.email) } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
    }
  })
}
