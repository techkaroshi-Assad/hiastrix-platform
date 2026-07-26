#!/usr/bin/env node
/**
 * Contact lookup — which strategy actually works?
 *
 * The client probe found `GET /contacts/?query=` returning nothing for a contact
 * created moments earlier. Two very different causes:
 *
 *   1. `query` does not match the way I assumed → the request is wrong.
 *   2. The search index is eventually consistent → the request is fine, but a
 *      just-created contact is invisible for a while, which changes how the
 *      agent should sequence find-then-create.
 *
 * So this tests every strategy against a contact that has existed for a long
 * time first, then measures how long a brand-new one takes to appear.
 *
 *   node ghl-search-probe.mjs
 *
 * Read-only apart from one contact it creates and deletes.
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

const results = []
const mark = (ok, label, detail = "") => {
  results.push({ ok, label })
  console.log(`  ${ok ? "WORKS " : "no    "} ${label}${detail ? `\n         ${detail}` : ""}`)
}

async function call(path, { token, method = "GET", body, form } = {}) {
  const headers = { Accept: "application/json", Version: VER }
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString() }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body) }

  const res  = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const text = await res.text()
  let parsed; try { parsed = JSON.parse(text) } catch { parsed = text }
  return { ok: res.ok, status: res.status, body: parsed }
}

const brief = v => {
  const s = typeof v === "string" ? v : JSON.stringify(v)
  return s.length > 200 ? s.slice(0, 200) + "…" : s
}

const idsFrom = r => {
  const list = r.body?.contacts ?? r.body?.contact ?? []
  return (Array.isArray(list) ? list : [list]).map(c => c?.id).filter(Boolean)
}

/* ── setup ────────────────────────────────────────────────────────────── */

if (!existsSync(STORE)) { console.error(`\n  No ${STORE}.\n`); process.exit(1) }
const t         = JSON.parse(readFileSync(STORE, "utf8"))
const agency    = t.access_token
const companyId = t.companyId ?? env("GHL_COMPANY_ID")
const appId     = env("GHL_APP_ID")

const inst = await call(`/oauth/installedLocations?appId=${appId}&companyId=${companyId}&limit=100`, { token: agency })
const hit  = (inst.body?.locations ?? []).find(l => (l.name ?? "").trim().toLowerCase() === TARGET_NAME.toLowerCase())
if (!hit) { console.error(`\n  No sub-account named "${TARGET_NAME}".\n`); process.exit(1) }
const locationId = hit._id ?? hit.id

const lt = await call("/oauth/locationToken", { token: agency, method: "POST", form: { companyId, locationId } })
if (!lt.ok) { console.error("  No location token:", brief(lt.body)); process.exit(1) }
const tok = lt.body.access_token

/* ── Part 1 — an existing contact, so indexing lag is not a factor ────── */

console.log(`\n══ Part 1 — searching a contact that already existed\n`)

const listed = await call(`/contacts/?locationId=${locationId}&limit=20`, { token: tok })
const pool   = (listed.body?.contacts ?? []).filter(c => c.email || c.phone)
const subject = pool.find(c => c.email && c.phone) ?? pool[0]

if (!subject) {
  console.log("  This sub-account has no contact with an email or phone to search for.")
  console.log("  Add one by hand and re-run — without a subject nothing below means anything.\n")
  process.exit(1)
}

console.log(`  Subject: ${subject.id}`)
console.log(`    name  ${[subject.firstName, subject.lastName].filter(Boolean).join(" ") || "(none)"}`)
console.log(`    email ${subject.email ?? "(none)"}`)
console.log(`    phone ${subject.phone ?? "(none)"}\n`)

const found = r => r.ok && idsFrom(r).includes(subject.id)

/* A — query string, the current implementation. */
if (subject.email) {
  const r = await call(`/contacts/?locationId=${locationId}&query=${encodeURIComponent(subject.email)}&limit=10`, { token: tok })
  mark(found(r), "GET /contacts/?query=<email>", `${r.status}, ${idsFrom(r).length} results`)
}
if (subject.phone) {
  const r = await call(`/contacts/?locationId=${locationId}&query=${encodeURIComponent(subject.phone)}&limit=10`, { token: tok })
  mark(found(r), "GET /contacts/?query=<phone>", `${r.status}, ${idsFrom(r).length} results`)
}
if (subject.firstName) {
  const r = await call(`/contacts/?locationId=${locationId}&query=${encodeURIComponent(subject.firstName)}&limit=20`, { token: tok })
  mark(found(r), "GET /contacts/?query=<first name>", `${r.status}, ${idsFrom(r).length} results`)
}

/* B — the dedicated lookup endpoint. */
if (subject.email) {
  const r = await call(`/contacts/lookup?locationId=${locationId}&email=${encodeURIComponent(subject.email)}`, { token: tok })
  mark(found(r), "GET /contacts/lookup?email=", `${r.status} ${r.ok ? "" : brief(r.body)}`)
}
if (subject.phone) {
  const r = await call(`/contacts/lookup?locationId=${locationId}&phone=${encodeURIComponent(subject.phone)}`, { token: tok })
  mark(found(r), "GET /contacts/lookup?phone=", `${r.status} ${r.ok ? "" : brief(r.body)}`)
}

/* C — the POST search endpoint, with filters. */
if (subject.email) {
  const r = await call("/contacts/search", {
    token: tok, method: "POST",
    body: {
      locationId, page: 1, pageLimit: 10,
      filters: [{ field: "email", operator: "eq", value: subject.email }],
    },
  })
  mark(found(r), "POST /contacts/search  filters email eq", `${r.status} ${r.ok ? "" : brief(r.body)}`)
}

/* D — POST search with a free-text term instead of filters. */
{
  const term = subject.email ?? subject.phone ?? subject.firstName
  const r = await call("/contacts/search", {
    token: tok, method: "POST",
    body: { locationId, page: 1, pageLimit: 10, query: term },
  })
  mark(found(r), "POST /contacts/search  query term", `${r.status} ${r.ok ? "" : brief(r.body)}`)
}

/* E — duplicate check, which some tenants use for exactly this. */
if (subject.email) {
  const r = await call(`/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(subject.email)}`, { token: tok })
  mark(found(r), "GET /contacts/search/duplicate?email=", `${r.status} ${r.ok ? "" : brief(r.body)}`)
}
if (subject.phone) {
  const r = await call(`/contacts/search/duplicate?locationId=${locationId}&number=${encodeURIComponent(subject.phone)}`, { token: tok })
  mark(found(r), "GET /contacts/search/duplicate?number=", `${r.status} ${r.ok ? "" : brief(r.body)}`)
}

/* ── Part 2 — how long before a new contact is findable? ─────────────── */

console.log(`\n══ Part 2 — indexing lag on a brand-new contact\n`)

const winner = results.find(r => r.ok)
if (!winner) {
  console.log("  Nothing worked in Part 1, so lag is not the issue. Stopping here.\n")
  process.exit(1)
}
console.log(`  Using: ${winner.label}\n`)

const marker = `zzprobe${Date.now()}`
const email  = `${marker}@example.invalid`
const made   = await call("/contacts/", {
  token: tok, method: "POST",
  body: { locationId, firstName: "zz-probe", lastName: marker, email },
})
const newId = made.body?.contact?.id ?? made.body?.id

if (!newId) {
  console.log(`  Could not create a contact: ${brief(made.body)}\n`)
  process.exit(1)
}

try {
  const attempt = async () => {
    if (winner.label.startsWith("GET /contacts/?query=")) {
      return call(`/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=10`, { token: tok })
    }
    if (winner.label.startsWith("GET /contacts/lookup")) {
      return call(`/contacts/lookup?locationId=${locationId}&email=${encodeURIComponent(email)}`, { token: tok })
    }
    if (winner.label.startsWith("GET /contacts/search/duplicate")) {
      return call(`/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(email)}`, { token: tok })
    }
    return call("/contacts/search", {
      token: tok, method: "POST",
      body: { locationId, page: 1, pageLimit: 10, filters: [{ field: "email", operator: "eq", value: email }] },
    })
  }

  let visibleAfter = null
  for (const wait of [0, 1000, 2000, 4000, 8000, 15000]) {
    if (wait) await new Promise(r => setTimeout(r, wait))
    const elapsed = [0, 1, 3, 7, 15, 30][[0, 1000, 2000, 4000, 8000, 15000].indexOf(wait)]
    const r = await attempt()
    const hit = r.ok && idsFrom(r).includes(newId)
    console.log(`  ~${String(elapsed).padStart(2)}s  ${hit ? "found" : "not yet"}`)
    if (hit) { visibleAfter = elapsed; break }
  }

  console.log("")
  if (visibleAfter === 0) {
    console.log("  No lag — a new contact is findable immediately.")
    console.log("  So the original failure was the request shape, not timing.")
  } else if (visibleAfter !== null) {
    console.log(`  Lag of roughly ${visibleAfter}s before a new contact is findable.`)
    console.log("  The agent must use the id returned by create, never search for someone it just made.")
  } else {
    console.log("  Still not findable after 30s. Treat search as unusable for fresh contacts.")
  }
} finally {
  const d = await call(`/contacts/${newId}`, { token: tok, method: "DELETE" })
  console.log(`\n  Cleanup: contact ${newId} → ${d.status}\n`)
}
