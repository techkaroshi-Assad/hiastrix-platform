/**
 * Placing one call — SERVER ONLY.
 *
 * The order of operations here is the whole design:
 *
 *     1. write the ledger row
 *     2. ask the provider to dial
 *     3. write down what it said
 *
 * Step 1 before step 2 is what makes a lost response survivable. If the process
 * dies between them, a row exists saying "we may have dialled this person and we
 * do not know", and the reaper can go and find out. With the ordering reversed
 * there is no record at all, and the only safe assumption — that we did not
 * dial — is the one that risks calling somebody twice.
 *
 * It is also what makes the double-dial guard real. The partial unique index on
 * (tenant_id, phone_e164) over live attempt states means a second campaign
 * dialling the same person while a call is up is rejected by Postgres before it
 * can reach the provider. The constraint is the coordination; there is no lock
 * and no race to lose.
 */

import { prisma } from "@/lib/prisma"
import { vapiCalls } from "@/lib/vapi/client"
import { campaignOverrides } from "@/lib/dialer/consent"
import { lookupCrmContact, lookupCrmContactById, buildLeadContext } from "@/lib/crm/lead-context"
import { PROVIDER_TIMEOUT_MS, CONNECT_LEASE_SECONDS, CRM_PRECALL_LOOKUP_TIMEOUT_MS } from "@/lib/dialer/config"
import type { ClaimedLead } from "@/lib/dialer/claim"

export type CallerNumber = {
  id: string
  vapiPhoneNumberId: string
  phoneNumber: string
  /** Calls placed from it in the last 24 hours. */
  dialsToday: number
  /**
   * This number's own rolling-24h ceiling: its `dailyCallCap` when set,
   * otherwise the platform default. Resolved once in context.ts so every
   * comparison here is against one number's real limit rather than a
   * single platform figure applied to numbers with very different
   * reputations and owners.
   */
  dailyCap: number
  /**
   * When the oldest of those calls falls out of the 24-hour window — i.e.
   * the earliest moment this number has a slot again. Null when it has no
   * calls in the window at all.
   */
  capFreesAt: Date | null
}

export type DialContext = {
  campaignId: string
  tenantId: string
  vapiAssistantId: string
  /** Null rotates; set pins every call to one caller ID. */
  pinnedNumberId: string | null
  numbers: CallerNumber[]
  /** platform_settings.number_daily_call_cap — the default for a number
   *  that has no cap of its own. Kept for reporting; the dial-time check
   *  uses each number's resolved `dailyCap`. */
  numberDailyCap: number
  /** platform_settings.contact_daily_cap */
  contactDailyCap: number
  /** Merge values available to the agent's opening line. */
  campaignName: string
  /** Null when the tenant has no CRM connected. Used only for the pre-dial
   *  lookup — never trusted from anything in the lead row itself. */
  crmLocationId: string | null

  /*
   * What the agent is obliged to say on this campaign's calls, composed at dial
   * time from the platform's consent line and the agent's own prompt. It never
   * passes through the agent form or the JSON editor, so there is nothing for a
   * tenant to remove. See lib/dialer/consent.ts.
   */
  agentSystemPrompt: string | null
  agentConfig: unknown
  /** The agent's own model, as `provider:id`. Repeated into the override
   *  because the provider rejects a model object without a provider — see
   *  lib/dialer/consent.ts. */
  agentModel: string | null
  consentLine: string
  voicemailMessage: string | null
}

export type DialResult =
  /** The provider has it. */
  | { kind: "placed"; attemptId: string; providerCallId: string }
  /** Another campaign is already on the phone to this person. */
  | { kind: "duplicate" }
  /** On the tenant's do-not-call list. */
  | { kind: "suppressed" }
  /** Dialled too many times in 24h, across every campaign. */
  | { kind: "contact_capped" }
  /**
   * No caller ID can be used right now. Two very different situations, and
   * the first production campaign taught us the difference matters: "the
   * agent has no numbers" needs a person to fix it; "every number is at its
   * daily cap" fixes itself in a few hours, and pausing a campaign for it
   * with a message saying no number is available sent the operator to check
   * their inventory, where the numbers were sitting exactly where they'd
   * left them.
   */
  | { kind: "no_number"; why: "none-attached" | "all-capped"; freesAt: Date | null }
  /** The provider refused outright — bad number, bad request. */
  | { kind: "rejected"; reason: string }
  /**
   * The provider refused for a reason that has nothing to do with this
   * lead and would refuse every other lead the same way: daily cap on
   * free numbers, no credit, frozen subscription. The campaign pauses
   * with the provider's words; the attempt is handed back.
   */
  | { kind: "account_blocked"; reason: string }
  /**
   * This one number is unusable at the provider — its id no longer resolves.
   * The number is flagged and skipped; the lead goes back in the queue and
   * the next tick reaches for a different number. The campaign does NOT
   * pause: the account is healthy and the other numbers still work.
   */
  | { kind: "number_dead"; reason: string; phoneNumberId: string }
  /** Rate limited. The campaign backs off wholesale. */
  | { kind: "throttled"; retryAfterMs: number }
  /** Placed or not — we could not tell. The reaper resolves it. */
  | { kind: "lost"; attemptId: string }

/**
 * The provider's refusals that are about the account, not the number.
 *
 * Returns the human-readable part of the message when it matches, null
 * when the refusal is genuinely per-lead (bad number, bad request). The
 * list is the provider's own error vocabulary for account-wide conditions:
 * free-number daily cap, no credit, subscription frozen, concurrency
 * ceiling, and a missing/invalid assistant or number id (which would fail
 * every lead identically).
 */
/**
 * The provider refusing ONE number, rather than the account.
 *
 * ── THE TWO HOURS THIS COST ───────────────────────────────────────────
 *
 * A Twilio number was re-imported on the provider side, so the id we had
 * stored stopped resolving. Every dial came back:
 *
 *   Vapi API error 400: `phoneNumber` `93e506d7-…` does not exist.
 *
 * `accountLevelRefusal` did not match it — its pattern is
 * `phone-number-not-found`, and the provider's actual wording here is
 * "does not exist" — so it fell through to the generic per-lead path:
 * re-queue the lead, try again next tick, forever. 174 rejected attempts
 * in two hours, zero calls placed.
 *
 * It was self-sustaining, and that is the part worth understanding.
 * Rejected attempts are deliberately excluded from a number's daily count
 * (so a failure cannot burn the cap), which left the dead number
 * permanently the least-used one — so `pickNumber` chose it every single
 * time, and the tenant's healthy second number was never tried once.
 *
 * This is deliberately NOT account-level: the account is fine, the other
 * numbers are fine, and pausing the whole campaign would be the wrong
 * response. The right response is to take this one number out of
 * rotation, flag it for re-sync, and carry on with the others.
 */
export function numberLevelRefusal(message: string): string | null {
  const m = message.toLowerCase()
  const hit =
    // "`phoneNumber` `<uuid>` does not exist."
    /`?phonenumber`?\s*`?[0-9a-f-]*`?\s*does not exist/.test(m) ||
    /phone(?:-| )?number(?:-| )?(?:not(?:-| )?found|does not exist|no longer exists)/.test(m) ||
    /phonenumberid.*(?:invalid|not found|does not exist)/.test(m)
  if (!hit) return null
  const json = /"message"\s*:\s*"([^"]+)"/.exec(message)
  return (json?.[1] ?? message).replace(/\s+/g, " ").trim().slice(0, 240)
}

export function accountLevelRefusal(message: string): string | null {
  const m = message.toLowerCase()
  const hit =
    /daily outbound call limit|outbound-daily-limit/.test(m) ||
    /insufficient (?:credit|balance|funds)|wallet|billing|subscription (?:frozen|inactive|paused)/.test(m) ||
    /concurrency limit|too many concurrent/.test(m) ||
    /assistant(?:-| )not(?:-| )(?:found|valid)|phone(?:-| )number(?:-| )not(?:-| )(?:found|valid)|invalid api key|unauthorized/.test(m)
  if (!hit) return null
  // Pull the provider's sentence out of the JSON wrapper when there is one.
  const json = /"message"\s*:\s*"([^"]+)"/.exec(message)
  return (json?.[1] ?? message).replace(/\s+/g, " ").trim().slice(0, 240)
}

/** Prisma's unique-violation code, and Postgres's underneath it. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: unknown }
  return e?.code === "P2002" || e?.code === "23505"
}

function statusOf(err: unknown): number | null {
  const m = /Vapi API error (\d{3})/.exec(err instanceof Error ? err.message : "")
  return m ? Number(m[1]) : null
}

/**
 * Choose a caller ID.
 *
 * Round-robin across the agent's numbers, least-used first, skipping any that
 * has hit its daily volume. Carriers spam-label a number that dials all day, so
 * spreading a campaign across several numbers is not cosmetic — it is the
 * difference between ringing and showing up as "Scam Likely".
 *
 * Mutates `dialsToday` so successive calls within one tick keep rotating without
 * a database round trip each time.
 */
export function pickNumber(ctx: DialContext): CallerNumber | null {
  if (ctx.pinnedNumberId) {
    const pinned = ctx.numbers.find(n => n.id === ctx.pinnedNumberId)
    // A pinned number over its cap stops the campaign rather than silently
    // presenting a different caller ID — the tenant pinned it for a reason.
    return pinned && pinned.dialsToday < pinned.dailyCap ? pinned : null
  }

  const eligible = ctx.numbers.filter(n => n.dialsToday < n.dailyCap)
  if (!eligible.length) return null

  return eligible.reduce((a, b) => (b.dialsToday < a.dialsToday ? b : a))
}

export async function placeCall(
  ctx: DialContext,
  lead: ClaimedLead,
  opts: { signal?: AbortSignal } = {}
): Promise<DialResult> {
  /* ── Guards that cost a query but save a phone call ─────────────────── */

  const suppressed = await prisma.suppression.findUnique({
    where: { tenantId_phoneE164: { tenantId: ctx.tenantId, phoneE164: lead.phoneE164 } },
    select: { id: true },
  })
  if (suppressed) return { kind: "suppressed" }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recent = await prisma.dialAttempt.count({
    where: {
      tenantId:  ctx.tenantId,
      phoneE164: lead.phoneE164,
      createdAt: { gte: since },
      // Attempts that never reached the provider are not contact.
      state:     { not: "LOST" },
    },
  })
  if (recent >= ctx.contactDailyCap) return { kind: "contact_capped" }

  const number = pickNumber(ctx)
  if (!number) {
    const pool = ctx.pinnedNumberId
      ? ctx.numbers.filter(n => n.id === ctx.pinnedNumberId)
      : ctx.numbers
    if (!pool.length) return { kind: "no_number", why: "none-attached", freesAt: null }
    // The earliest moment any number in the pool has a slot again.
    const frees = pool
      .map(n => n.capFreesAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((x, y) => x.getTime() - y.getTime())[0] ?? null
    return { kind: "no_number", why: "all-capped", freesAt: frees }
  }

  /*
   * Who is this, really — asked once, before the ledger row even exists.
   *
   * A lead pulled from a CRM tag already carries its contact id (see
   * lib/dialer/import.ts); one from a spreadsheet never has, so it is looked
   * up here by phone number. Bounded and best-effort: a slow or unreachable
   * CRM must never be the reason a call did not go out, so a miss or a
   * timeout simply means the agent is told nothing rather than something
   * wrong. Found or not, the outcome feeds the same lead-context shape used
   * everywhere else a call is briefed — see lib/crm/lead-context.ts.
   */
  const crmContact = lead.crmContactId
    ? await lookupCrmContactById(ctx.crmLocationId, lead.crmContactId, CRM_PRECALL_LOOKUP_TIMEOUT_MS)
    : await lookupCrmContact(ctx.crmLocationId, lead.phoneE164, CRM_PRECALL_LOOKUP_TIMEOUT_MS)

  // Newly discovered, not previously linked — worth writing back so the next
  // attempt (a retry, a callback) does not pay for the same lookup again, and
  // so the lead's own record reflects it. Never worth failing the dial over.
  if (crmContact && !lead.crmContactId) {
    try {
      await prisma.campaignLead.update({
        where: { id: lead.leadId },
        data:  { crmContactId: crmContact.id },
      })
    } catch { /* cosmetic; the dial proceeds either way */ }
  }

  const leadContext = buildLeadContext({
    name: lead.contactName,
    fields: lead.fields,
    crmContact,
  })

  /* ── 1. The ledger row, before the provider hears about it ──────────── */

  let attemptId: string
  try {
    const attempt = await prisma.dialAttempt.create({
      data: {
        tenantId:       ctx.tenantId,
        campaignId:     ctx.campaignId,
        campaignLeadId: lead.leadId,
        attemptNo:      lead.attemptNo,
        phoneE164:      lead.phoneE164,
        phoneNumberId:  number.id,
        state:          "PLACING",
        leaseExpiresAt: new Date(Date.now() + CONNECT_LEASE_SECONDS * 1000),
      },
      select: { id: true },
    })
    attemptId = attempt.id

    /*
     * Stamp the lead with when it was actually dialled.
     *
     * Written here, beside the attempt itself, because this is the only
     * moment that means "called". `updatedAt` cannot stand in for it: any
     * bulk operation rewrites that across every row at once, which is how
     * the campaign's call log ended up showing an 08:25 call above calls
     * placed hours later. Best-effort — a failed stamp must not cost a
     * call that is about to be placed.
     */
    await prisma.campaignLead.update({
      where: { id: lead.leadId },
      data:  { lastAttemptAt: new Date() },
    }).catch(() => {})
  } catch (err) {
    // The partial unique index fired: someone else is on the phone to this
    // person right now. Nothing reached the provider.
    if (isUniqueViolation(err)) return { kind: "duplicate" }
    throw err
  }

  number.dialsToday += 1

  /* ── 2. Dial ────────────────────────────────────────────────────────── */

  let providerCallId: string
  try {
    const created = await vapiCalls.create(
      {
        assistantId:   ctx.vapiAssistantId,
        phoneNumberId: number.vapiPhoneNumberId,
        customer:      { number: lead.phoneE164 },
        // Echoed back on every server message for this call. It is how a dial
        // is recognised when the response below never reaches us.
        metadata: {
          astrixAttemptId:  attemptId,
          astrixCampaignId: ctx.campaignId,
        },
        assistantOverrides: campaignOverrides({
          agentSystemPrompt: ctx.agentSystemPrompt,
          agentConfig:       ctx.agentConfig,
          agentModel:        ctx.agentModel,
          consentLine:       ctx.consentLine,
          campaignName:      ctx.campaignName,
          leadContext,
          voicemailMessage:  ctx.voicemailMessage,
        }),
      },
      { signal: opts.signal, timeoutMs: PROVIDER_TIMEOUT_MS }
    )

    providerCallId = created?.id ?? ""
    if (!providerCallId) {
      // A 200 with no id. Treat it exactly like a lost response, because it is
      // one: the call may be live and we cannot name it.
      return { kind: "lost", attemptId }
    }
  } catch (err) {
    const status = statusOf(err)

    if (status === 429) {
      await prisma.dialAttempt.update({
        where: { id: attemptId },
        data:  { state: "ENDED", error: "rate limited", endedReason: "astrix-throttled" },
      })
      return { kind: "throttled", retryAfterMs: 30_000 }
    }

    // A refusal we can name. The call was definitely not placed.
    if (status !== null && status >= 400 && status < 500 && status !== 408) {
      const reason = err instanceof Error ? err.message : "rejected"
      await prisma.dialAttempt.update({
        where: { id: attemptId },
        data:  { state: "ENDED", error: reason.slice(0, 500), endedReason: "astrix-rejected" },
      })
      /*
       * Was it this number, or was it us?
       *
       * "Couldn't Start Call. Numbers Bought On Vapi Have A Daily Outbound
       * Call Limit" is not a fact about the lead. Treating it as one wrote
       * "we couldn't place a call to this number" against 380 perfectly
       * good numbers in one afternoon and marked them all failed, while
       * the campaign kept going and did the same to the next lead. An
       * account-level refusal stops the campaign, hands the attempt back,
       * and tells the operator the provider's actual words.
       */
      /*
       * Checked BEFORE the account-level test, because a dead number is the
       * narrower diagnosis and the one that must not pause a healthy
       * campaign. Flagged here rather than by the caller so that a number
       * cannot be chosen again even within this same tick — the loop that
       * burned 174 attempts did so at three a minute.
       */
      const dead = numberLevelRefusal(reason)
      if (dead) {
        await prisma.phoneNumber.update({
          where: { id: number.id },
          data:  { providerError: dead, providerErrorAt: new Date() },
        }).catch(() => {
          // Flagging is best-effort: failing to record it must not turn a
          // recoverable refusal into a lost attempt.
        })
        return { kind: "number_dead", reason: dead, phoneNumberId: number.id }
      }

      const account = accountLevelRefusal(reason)
      if (account) return { kind: "account_blocked", reason: account }
      return { kind: "rejected", reason }
    }

    // Timeout, 5xx, socket error — the request may or may not have landed. The
    // row stays PLACING with no provider id, which is precisely the state the
    // reaper knows how to resolve.
    await prisma.dialAttempt.update({
      where: { id: attemptId },
      data:  { error: (err instanceof Error ? err.message : "unknown").slice(0, 500) },
    })
    return { kind: "lost", attemptId }
  }

  /* ── 3. Write down what it said ─────────────────────────────────────── */

  await prisma.dialAttempt.update({
    where: { id: attemptId },
    data:  { providerCallId, state: "DIALING" },
  })

  return { kind: "placed", attemptId, providerCallId }
}
