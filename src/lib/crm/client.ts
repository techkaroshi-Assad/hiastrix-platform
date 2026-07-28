/**
 * CRM API client — SERVER ONLY.
 *
 * Astrix owns one agency; every tenant is a sub-account inside it. This module
 * holds the single agency credential and mints a short-lived, sub-account-scoped
 * token for each call, so a request made on behalf of one tenant is refused by
 * the provider if it reaches for another. That refusal is verified, not assumed:
 * a token minted for one sub-account returns 403 against a sibling.
 *
 * Every function here takes an explicit `locationId`. There is deliberately no
 * ambient "current location" — the caller must have resolved a tenant first, and
 * making that a parameter means a missing resolution is a type error rather than
 * a silent cross-tenant write.
 *
 * The vendor is never named in anything reachable from a tenant. Errors thrown
 * here carry the raw provider body on purpose, for `sanitiseError` to scrub at
 * the route boundary — the same contract as the voice client.
 */

import { prisma } from "@/lib/prisma"

const BASE    = "https://services.leadconnectorhq.com"
const VERSION = "2021-07-28"

/** Refresh this far ahead of expiry so an in-flight call never races the clock. */
const REFRESH_WINDOW_MS = 10 * 60 * 1000

export function crmConfigured() {
  return Boolean(process.env.CRM_CLIENT_ID && process.env.CRM_CLIENT_SECRET)
}

/* ── HTTP ──────────────────────────────────────────────────────────────── */

type Query = Record<string, string | number | undefined>

function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function crmRequest<T>(
  path: string,
  { token, method = "GET", body, form }: {
    token: string
    method?: string
    body?: unknown
    form?: Record<string, string>
  }
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept:        "application/json",
    Version:       VERSION,
  }

  let payload: string | undefined
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded"
    payload = new URLSearchParams(form).toString()
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json"
    payload = JSON.stringify(body)
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CRM API error ${res.status}: ${text}`)
  }

  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

/* ── Agency token ──────────────────────────────────────────────────────── */

type TokenResponse = {
  access_token:  string
  refresh_token: string
  expires_in:    number
  companyId?:    string
  locationId?:   string
}

/** Unauthenticated — the client credentials are the authentication. */
async function tokenExchange(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method:  "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      client_id:     process.env.CRM_CLIENT_ID ?? "",
      client_secret: process.env.CRM_CLIENT_SECRET ?? "",
      ...form,
    }).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`CRM API error ${res.status}: ${text}`)
  return JSON.parse(text) as TokenResponse
}

/** Exchange the authorization code from the consent screen. Used once, by the
 *  admin connect flow. */
export async function exchangeAuthorizationCode(code: string, redirectUri: string) {
  const t = await tokenExchange({
    grant_type:   "authorization_code",
    code,
    user_type:    "Company",
    redirect_uri: redirectUri,
  })
  if (!t.companyId) throw new Error("CRM API error 200: no companyId on the token response")
  return t
}

export type CrmConnectionRow = {
  companyId:    string
  accessToken:  string
  refreshToken: string
  expiresAt:    Date
}

async function readConnection(): Promise<CrmConnectionRow | null> {
  return prisma.crmConnection.findUnique({
    where:  { id: true },
    select: { companyId: true, accessToken: true, refreshToken: true, expiresAt: true },
  })
}

/**
 * The agency access token, refreshed if it is close to expiring.
 *
 * The provider rotates the refresh token on every use, which makes concurrent
 * refreshes genuinely dangerous: two instances both refresh, both receive a new
 * pair, and whichever writes second persists a token the provider has already
 * invalidated. Losing the agency refresh token breaks CRM access for every
 * tenant at once and can only be fixed by re-running the consent flow by hand.
 *
 * So the write is conditional on the refresh token we started from. A loser
 * updates nothing and re-reads the row the winner wrote.
 */
export async function agencyToken(): Promise<{ token: string; companyId: string }> {
  const row = await readConnection()
  if (!row) throw new Error("CRM API error 401: no connection")

  if (row.expiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS) {
    return { token: row.accessToken, companyId: row.companyId }
  }

  const fresh = await tokenExchange({
    grant_type:    "refresh_token",
    refresh_token: row.refreshToken,
    user_type:     "Company",
  })

  const written = await prisma.crmConnection.updateMany({
    where: { id: true, refreshToken: row.refreshToken },
    data: {
      accessToken:  fresh.access_token,
      refreshToken: fresh.refresh_token,
      expiresAt:    new Date(Date.now() + fresh.expires_in * 1000),
    },
  })

  if (written.count === 0) {
    // Someone else rotated while we were in flight. Theirs is the live pair.
    const current = await readConnection()
    if (current) return { token: current.accessToken, companyId: current.companyId }
  }

  return { token: fresh.access_token, companyId: row.companyId }
}

/* ── Location tokens ───────────────────────────────────────────────────── */

/**
 * Minted per sub-account and cached in module scope for the life of the
 * instance.
 *
 * These come back with a refresh token of their own, which we deliberately
 * ignore. Refreshing would mean tracking a rotating pair per sub-account, where
 * one lost write silently breaks that tenant's CRM until someone notices.
 * Re-minting from the agency token is idempotent and costs one request on a cold
 * instance.
 */
const locationCache = new Map<string, { token: string; expiresAt: number }>()

/** A minute of headroom, so a token cannot expire between the check and the call. */
const LOCATION_SKEW_MS = 60 * 1000

export async function locationToken(locationId: string): Promise<string> {
  const cached = locationCache.get(locationId)
  if (cached && cached.expiresAt - Date.now() > LOCATION_SKEW_MS) return cached.token

  const { token: agency, companyId } = await agencyToken()

  const minted = await crmRequest<TokenResponse>("/oauth/locationToken", {
    token:  agency,
    method: "POST",
    form:   { companyId, locationId },
  })

  locationCache.set(locationId, {
    token:     minted.access_token,
    expiresAt: Date.now() + minted.expires_in * 1000,
  })
  return minted.access_token
}

/** Drop a cached token — used when a tenant is remapped to a different
 *  sub-account, so the next call cannot act on the old one. */
export function forgetLocation(locationId: string) {
  locationCache.delete(locationId)
}

/** Scoped request helper. Everything below goes through this. */
async function atLocation<T>(
  locationId: string,
  path: string,
  init: { method?: string; body?: unknown; query?: Query } = {}
): Promise<T> {
  const token = await locationToken(locationId)
  return crmRequest<T>(withQuery(path, init.query), {
    token,
    method: init.method,
    body:   init.body,
  })
}

/* ── Agency-scoped reads ───────────────────────────────────────────────── */

export type CrmSubAccount = { id: string; name: string; address?: string }

/**
 * Sub-accounts this app is installed on.
 *
 * Two endpoints answer nearly the same question and disagree on the id field —
 * `installedLocations` returns `_id`, `locations/search` returns `id`. We use the
 * install list because a sub-account the app is not installed on cannot be
 * tokenised, so offering it in a picker would only produce a broken tenant.
 */
export const crmLocations = {
  async list(): Promise<CrmSubAccount[]> {
    const { token, companyId } = await agencyToken()
    const appId = process.env.CRM_APP_ID ?? ""

    const res = await crmRequest<{ locations?: Record<string, unknown>[] }>(
      withQuery("/oauth/installedLocations", { appId, companyId, limit: 500 }),
      { token }
    )

    return (res.locations ?? []).map(l => ({
      id:      String(l._id ?? l.id ?? ""),
      name:    String(l.name ?? "Untitled"),
      address: l.address ? String(l.address) : undefined,
    })).filter(l => l.id)
  },
}

/* ── Contacts ──────────────────────────────────────────────────────────── */

export type CrmContact = {
  id:        string
  firstName?: string
  lastName?:  string
  email?:     string
  phone?:     string
  tags?:      string[]
}

export const crmContacts = {
  /**
   * Free-text lookup across name, email and phone.
   *
   * Backed by a search index that lags roughly seven seconds behind a write —
   * measured, not assumed. Fine for "is this caller already a client?", useless
   * for finding someone the agent created moments ago, which is why every write
   * tool takes the id returned by create rather than searching again.
   */
  async search(locationId: string, query: string): Promise<CrmContact[]> {
    const res = await atLocation<{ contacts?: CrmContact[] }>(locationId, "/contacts/", {
      query: { locationId, query, limit: 5 },
    })
    return res.contacts ?? []
  },

  /**
   * Exact match on an email address or phone number.
   *
   * This is the duplicate-detection endpoint, which the CRM has to answer from
   * live data — it is what stops a contact being created twice — so it should
   * not carry the index lag that `search` does. Tried first whenever the caller
   * gave something exact, with `search` as the fallback for names.
   */
  async lookupExact(
    locationId: string,
    by: { email?: string; phone?: string }
  ): Promise<CrmContact | null> {
    const query: Query = { locationId }
    if (by.email) query.email = by.email
    // The parameter really is `number` here, while every other endpoint calls
    // it `phone`. Their inconsistency, not a typo.
    if (by.phone) query.number = by.phone
    if (!by.email && !by.phone) return null

    const res = await atLocation<{ contact?: CrmContact }>(
      locationId, "/contacts/search/duplicate", { query }
    )
    return res.contact ?? null
  },

  async get(locationId: string, contactId: string): Promise<CrmContact | null> {
    const res = await atLocation<{ contact?: CrmContact }>(locationId, `/contacts/${contactId}`)
    return res.contact ?? null
  },

  async create(locationId: string, data: Record<string, unknown>): Promise<CrmContact> {
    const res = await atLocation<{ contact?: CrmContact } & CrmContact>(locationId, "/contacts/", {
      method: "POST",
      body:   { ...data, locationId },
    })
    return res.contact ?? res
  },

  /**
   * Custom field values ride in the same body as the plain fields, keyed on the
   * field's own id with the value under `value`. Verified by writing and reading
   * back — the provider returns 200 for shapes it silently ignores.
   */
  async update(locationId: string, contactId: string, data: Record<string, unknown>) {
    return atLocation<{ contact?: CrmContact }>(locationId, `/contacts/${contactId}`, {
      method: "PUT",
      body:   data,
    })
  },

  async addNote(locationId: string, contactId: string, body: string) {
    return atLocation(locationId, `/contacts/${contactId}/notes`, {
      method: "POST",
      body:   { body },
    })
  },

  /** Returns the tags that were genuinely new — re-applying an existing tag
   *  succeeds with an empty `tagsAdded`, and reporting off the status code would
   *  claim work that did not happen. */
  async addTags(locationId: string, contactId: string, tags: string[]): Promise<string[]> {
    const res = await atLocation<{ tagsAdded?: string[] }>(
      locationId, `/contacts/${contactId}/tags`, { method: "POST", body: { tags } }
    )
    return res.tagsAdded ?? []
  },

  async removeTags(locationId: string, contactId: string, tags: string[]): Promise<string[]> {
    const res = await atLocation<{ tagsRemoved?: string[] }>(
      locationId, `/contacts/${contactId}/tags`, { method: "DELETE", body: { tags } }
    )
    return res.tagsRemoved ?? []
  },

  /**
   * Everyone carrying a tag. The lead source for a campaign built from the CRM.
   *
   * Tags rather than smart lists, because smart lists are not in the public API
   * and tags are — and because tags are already how this platform divides a
   * sub-account up, so a tenant is choosing from something we built for them.
   *
   * Paged with `searchAfter`, which is the only way this endpoint will go past
   * its first few hundred: the cursor comes back on each page and the next
   * request replays it. Falling back to page numbers when it is absent, because
   * a list that stops silently at 100 is worse than one that pages clumsily.
   *
   * Capped, deliberately. A tag matching thirty thousand contacts is a mistake
   * somebody is about to make expensive, and stopping at the cap gives them a
   * number they can look at before any of it rings.
   */
  async byTag(locationId: string, tag: string, max = 5000): Promise<CrmContact[]> {
    const out: CrmContact[] = []
    let searchAfter: unknown[] | null = null
    let page = 1

    while (out.length < max) {
      const body: Record<string, unknown> = {
        locationId,
        pageLimit: Math.min(100, max - out.length),
        filters: [{ field: "tags", operator: "contains", value: tag.toLowerCase() }],
      }
      if (searchAfter) body.searchAfter = searchAfter
      else if (page > 1) body.page = page

      const res = await atLocation<{
        contacts?: Record<string, unknown>[]
        total?: number
      }>(locationId, "/contacts/search", { method: "POST", body })

      const batch = res.contacts ?? []
      if (!batch.length) break

      for (const c of batch) {
        out.push({
          id:        String(c.id ?? c._id ?? ""),
          firstName: c.firstName ? String(c.firstName) : undefined,
          lastName:  c.lastName ? String(c.lastName) : undefined,
          email:     c.email ? String(c.email) : undefined,
          phone:     c.phone ? String(c.phone) : undefined,
          tags:      Array.isArray(c.tags) ? c.tags.map(String) : undefined,
        })
      }

      const last = batch[batch.length - 1] as { searchAfter?: unknown[] }
      searchAfter = Array.isArray(last?.searchAfter) ? last.searchAfter : null
      page += 1

      // No cursor and no growth means we are re-reading page one. Stop rather
      // than loop.
      if (!searchAfter && batch.length < 100) break
    }

    return out.filter(c => c.id).slice(0, max)
  },
}

/* ── Opportunities ─────────────────────────────────────────────────────── */

export type CrmStage    = { id: string; name: string }
export type CrmPipeline = { id: string; name: string; stages: CrmStage[] }

export const crmOpportunities = {
  /** Stages nest inside each pipeline, so a stage picker needs one call. */
  async pipelines(locationId: string): Promise<CrmPipeline[]> {
    const res = await atLocation<{ pipelines?: Record<string, unknown>[] }>(
      locationId, "/opportunities/pipelines", { query: { locationId } }
    )
    return (res.pipelines ?? []).map(p => ({
      id:     String(p.id ?? ""),
      name:   String(p.name ?? "Untitled"),
      stages: (Array.isArray(p.stages) ? p.stages : []).map((s: Record<string, unknown>) => ({
        id:   String(s.id ?? ""),
        name: String(s.name ?? "Untitled"),
      })),
    }))
  },

  async create(locationId: string, data: Record<string, unknown>) {
    return atLocation<{ opportunity?: { id?: string } }>(locationId, "/opportunities/", {
      method: "POST",
      body:   { ...data, locationId },
    })
  },

  /** `pipelineStageId` alone moves it; `pipelineId` is not required. */
  async moveStage(locationId: string, opportunityId: string, pipelineStageId: string) {
    return atLocation(locationId, `/opportunities/${opportunityId}`, {
      method: "PUT",
      body:   { pipelineStageId },
    })
  },

  async search(locationId: string, contactId: string) {
    const res = await atLocation<{ opportunities?: { id: string; name?: string; pipelineId?: string }[] }>(
      locationId, "/opportunities/search", { query: { location_id: locationId, contact_id: contactId } }
    )
    return res.opportunities ?? []
  },
}

/* ── Calendars ─────────────────────────────────────────────────────────── */

export type CrmCalendar = { id: string; name: string }

export const crmCalendars = {
  async list(locationId: string): Promise<CrmCalendar[]> {
    const res = await atLocation<{ calendars?: Record<string, unknown>[] }>(
      locationId, "/calendars/", { query: { locationId } }
    )
    return (res.calendars ?? []).map(c => ({
      id:   String(c.id ?? ""),
      name: String(c.name ?? "Untitled"),
    })).filter(c => c.id)
  },

  /**
   * Free slots take epoch milliseconds and spell the parameter `timezone`,
   * while the booking body spells it `timeZone`. That is the provider's
   * inconsistency, not a typo — do not "fix" either one.
   */
  async freeSlots(
    locationId: string,
    calendarId: string,
    opts: { startMs: number; endMs: number; timeZone: string }
  ): Promise<string[]> {
    const res = await atLocation<Record<string, unknown>>(
      locationId, `/calendars/${calendarId}/free-slots`,
      { query: { startDate: opts.startMs, endDate: opts.endMs, timezone: opts.timeZone } }
    )

    // Response is keyed by date, each holding { slots: [...] }, with a couple of
    // non-date keys mixed in at the top level.
    const out: string[] = []
    for (const value of Object.values(res)) {
      const slots = (value as { slots?: unknown })?.slots
      if (Array.isArray(slots)) out.push(...slots.map(String))
    }
    return out
  },

  async book(locationId: string, data: Record<string, unknown>) {
    return atLocation<{ id?: string }>(locationId, "/calendars/events/appointments", {
      method: "POST",
      body:   { ...data, locationId },
    })
  },
}

/* ── Structure the operator built by hand ──────────────────────────────── */

export type CrmCustomField = { id: string; name: string; fieldKey: string; dataType: string }

export const crmMeta = {
  async customFields(locationId: string): Promise<CrmCustomField[]> {
    const res = await atLocation<{ customFields?: Record<string, unknown>[] }>(
      locationId, `/locations/${locationId}/customFields`
    )
    return (res.customFields ?? [])
      .filter(f => f.model === undefined || f.model === "contact")
      .map(f => ({
        id:       String(f.id ?? ""),
        name:     String(f.name ?? "Untitled"),
        fieldKey: String(f.fieldKey ?? ""),
        dataType: String(f.dataType ?? "TEXT"),
      }))
      .filter(f => f.id)
  },

  async tags(locationId: string): Promise<string[]> {
    const res = await atLocation<{ tags?: Record<string, unknown>[] }>(
      locationId, `/locations/${locationId}/tags`
    )
    return (res.tags ?? []).map(t => String(t.name ?? "")).filter(Boolean)
  },
}
