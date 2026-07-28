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
import { PROVIDER_TIMEOUT_MS, CONNECT_LEASE_SECONDS } from "@/lib/dialer/config"
import type { ClaimedLead } from "@/lib/dialer/claim"

export type CallerNumber = {
  id: string
  vapiPhoneNumberId: string
  phoneNumber: string
  /** Calls placed from it in the last 24 hours. */
  dialsToday: number
}

export type DialContext = {
  campaignId: string
  tenantId: string
  vapiAssistantId: string
  /** Null rotates; set pins every call to one caller ID. */
  pinnedNumberId: string | null
  numbers: CallerNumber[]
  /** platform_settings.number_daily_call_cap */
  numberDailyCap: number
  /** platform_settings.contact_daily_cap */
  contactDailyCap: number
  /** Merge values available to the agent's opening line. */
  campaignName: string

  /*
   * What the agent is obliged to say on this campaign's calls, composed at dial
   * time from the platform's consent line and the agent's own prompt. It never
   * passes through the agent form or the JSON editor, so there is nothing for a
   * tenant to remove. See lib/dialer/consent.ts.
   */
  agentSystemPrompt: string | null
  agentConfig: unknown
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
  /** Every caller ID has hit its daily volume, or the agent has none. */
  | { kind: "no_number" }
  /** The provider refused outright — bad number, bad request. */
  | { kind: "rejected"; reason: string }
  /** Rate limited. The campaign backs off wholesale. */
  | { kind: "throttled"; retryAfterMs: number }
  /** Placed or not — we could not tell. The reaper resolves it. */
  | { kind: "lost"; attemptId: string }

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
    return pinned && pinned.dialsToday < ctx.numberDailyCap ? pinned : null
  }

  const eligible = ctx.numbers.filter(n => n.dialsToday < ctx.numberDailyCap)
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
  if (!number) return { kind: "no_number" }

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
          consentLine:       ctx.consentLine,
          campaignName:      ctx.campaignName,
          contactName:       lead.contactName,
          fields:            lead.fields,
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
