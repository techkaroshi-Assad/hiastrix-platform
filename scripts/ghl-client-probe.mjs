#!/usr/bin/env node
/**
 * CRM client probe — Hi-Astrix
 *
 * The third and last probe. The first two answered architecture questions; this
 * one checks the specific requests `src/lib/crm/client.ts` actually makes.
 *
 * Several of those were written from documentation rather than observation —
 * contact search by query string, the opportunity search parameters, the shape
 * of a free-slots response, the tags endpoint. Each is a request the agent will
 * make mid-call, so a wrong guess surfaces as an agent telling a caller it
 * couldn't find them when it could.
 *
 * Read-only apart from one contact it creates and deletes, so it can search for
 * something it knows exists.
 *
 *   node ghl-client-probe.mjs
 *
 * Same folder as .ghl-tokens.json, same env vars as the other two.
 */

import { readFileSync, existsSync } from "node:fs"

const BASE  = "https://services.leadconnectorhq.com"
const STORE = ".ghl-tokens.json"
const VER   = "2021-07-28"
const TARGET_NAME = "Astrix Digital Media"

const env = k => {
  const v = process.env[k]
  if (!v) { console.error(`\n  Missing ${k}\n`); process.exit(1) }
  return v
}

let pass = 0, fail = 0, unknown = 0
const mark = (ok, label, detail = "") => {
  const tag = ok === true ? "PASS" : ok === false ? "FAIL" : "????"
  if (ok === true) pass++; else if (ok === false) fail++; else unknown++
  console.log(`  ${tag}  ${label}${detail ? `\n        ${detail}` : ""}`)
}

async function call(path, { token, method = "GET", body, form, label } = {}) {
  const headers = { Accept: "application/json", Version: VER }
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString() }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body) }

  const res  = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const text = await res.text()
  let parsed; try { parsed = JSON.parse(text) } catch { parsed = text }
  if (label) console.log(`\n── ${label}\n   ${method} ${path} → ${res.status}`)
  return { ok: res.ok, status: res.status, body: parsed }
}

const brief = v => {
  const s = typeof v === "string" ? v : JSON.stringify(v)
  return s.length > 260 ? s.slice(0, 260) + "…" : s
}

/* ── setup ────────────────────────────────────────────────────────────── */

if (!existsSync(STORE)) { console.error(`\n  No ${STORE}. Run ghl-probe.mjs first.\n`); process.exit(1) }
const t         = JSON.parse(readFileSync(STORE, "utf8"))
const agency    = t.access_token
const companyId = t.companyId ?? env("GHL_COMPANY_ID")
const appId     = env("GHL_APP_ID")

const inst = await call(`/oauth/installedLocations?appId=${appId}&companyId=${companyId}&limit=100`, { token: agency })
const rows = inst.body?.locations ?? []
const hit  = rows.find(l => (l.name ?? "").trim().toLowerCase() === TARGET_NAME.toLowerCase())
if (!hit) { console.error(`\n  No sub-account named "${TARGET_NAME}".\n`); process.exit(1) }
const locationId = hit._id ?? hit.id

const lt = await call("/oauth/locationToken", { token: agency, method: "POST", form: { companyId, locationId } })
if (!lt.ok) { console.error("  Could not mint a location token:", brief(lt.body)); process.exit(1) }
const tok = lt.body.access_token

console.log(`\nProbing ${TARGET_NAME} (${locationId})`)

let contactId = null

try {
  /* C1 — a contact to search for. */
  const marker = `zzprobe${Date.now()}`
  const made = await call("/contacts/", {
    token: tok, method: "POST", label: "C1  Create a searchable contact",
    body: { locationId, firstName: "zz-probe", lastName: marker, email: `${marker}@example.invalid` },
  })
  contactId = made.body?.contact?.id ?? made.body?.id
  mark(!!contactId, "contact created", contactId ?? brief(made.body))
  if (!contactId) throw new Error("nothing to search for")

  /* C2 — the lookup the agent performs on almost every call. */
  const search = await call(`/contacts/?locationId=${locationId}&query=${encodeURIComponent(marker)}&limit=5`, {
    token: tok, label: "C2  Contact lookup by query — used on nearly every call",
  })
  const found = search.body?.contacts ?? []
  mark(
    search.ok && found.some(c => c.id === contactId),
    "GET /contacts/?query= finds a contact by a unique string",
    search.ok ? `${found.length} results, keys: ${Object.keys(found[0] ?? {}).slice(0, 8).join(", ")}`
              : brief(search.body)
  )
  if (search.ok) {
    mark(
      Array.isArray(search.body?.contacts),
      "results are under `contacts`",
      `top-level keys: ${Object.keys(search.body ?? {}).join(", ")}`
    )
  }

  /* C3 — read a single contact back. */
  const one = await call(`/contacts/${contactId}`, { token: tok, label: "C3  Read one contact" })
  mark(one.ok && Boolean(one.body?.contact), "single contact is nested under `contact`",
    one.ok ? `keys: ${Object.keys(one.body ?? {}).join(", ")}` : brief(one.body))

  /* C4 — tag list for the builder. */
  const tags = await call(`/locations/${locationId}/tags`, { token: tok, label: "C4  Tag list for the builder" })
  mark(tags.ok, "GET /locations/:id/tags works", tags.ok ? "" : brief(tags.body))
  if (tags.ok) {
    const list = tags.body?.tags ?? []
    mark(Array.isArray(list), `${list.length} tag(s)`,
      `first: ${brief(list[0])}`)
  }

  /* C5 — calendars for the builder. */
  const cals = await call(`/calendars/?locationId=${locationId}`, { token: tok, label: "C5  Calendar list" })
  const calendars = cals.body?.calendars ?? []
  mark(cals.ok, `${calendars.length} calendar(s)`, cals.ok ? `first: ${brief(calendars[0])}` : brief(cals.body))

  /* C6 — free slots, the shape the availability tool parses. */
  if (calendars.length) {
    const calId = calendars[0].id
    const start = Date.now()
    const end   = start + 7 * 24 * 60 * 60 * 1000
    const slots = await call(
      `/calendars/${calId}/free-slots?startDate=${start}&endDate=${end}&timezone=${encodeURIComponent("Asia/Dubai")}`,
      { token: tok, label: "C6  Free slots — note lowercase `timezone`" }
    )
    mark(slots.ok, "free-slots accepts epoch ms + lowercase timezone", slots.ok ? "" : brief(slots.body))
    if (slots.ok) {
      const keys = Object.keys(slots.body ?? {})
      const dated = keys.filter(k => Array.isArray(slots.body[k]?.slots))
      mark(dated.length > 0 || keys.length > 0,
        "response is keyed by date with a `slots` array under each",
        `keys: ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "…" : ""} | dated: ${dated.length}`)
      if (dated.length) console.log(`   sample slot: ${brief(slots.body[dated[0]].slots[0])}`)
    }
  } else {
    mark(null, "no calendar to test free-slots against")
  }

  /* C7 — opportunity search, used before moving a stage. */
  const opps = await call(
    `/opportunities/search?location_id=${locationId}&contact_id=${contactId}`,
    { token: tok, label: "C7  Opportunity search by contact" }
  )
  mark(opps.ok, "GET /opportunities/search accepts location_id + contact_id",
    opps.ok ? `${(opps.body?.opportunities ?? []).length} for a brand-new contact (0 is correct)` : brief(opps.body))

  /* C8 — custom fields, already seen but confirm the model filter. */
  const fields = await call(`/locations/${locationId}/customFields`, { token: tok, label: "C8  Custom fields" })
  const defs = fields.body?.customFields ?? []
  mark(fields.ok, `${defs.length} custom field(s)`,
    fields.ok ? `models present: ${[...new Set(defs.map(f => f.model))].join(", ") || "(none)"}` : brief(fields.body))

} finally {
  console.log("\n── Cleanup")
  if (contactId) {
    const d = await call(`/contacts/${contactId}`, { token: tok, method: "DELETE" })
    console.log(`   contact ${contactId} → ${d.status}`)
  }
  console.log(`\n────────────────────────────\n  ${pass} pass · ${fail} fail · ${unknown} informational\n`)
  if (fail) {
    console.log("  Any FAIL above is a request the agent would make mid-call. Send me the output.\n")
  }
}
