/**
 * Taking work off the queue — SERVER ONLY.
 *
 * One SQL statement decides everything: whether the campaign may run, whether
 * the tenant may pay, whether the clock allows it, how many calls are already up,
 * and which leads to take. It is one statement because every seam between those
 * checks is a window where the answer changes underneath us.
 *
 * ── WHY ONE STATEMENT AND NOT FIVE ────────────────────────────────────
 *
 * The obvious shape is: read the campaign, check credit, count in flight, then
 * claim. Between the third and fourth of those, a call ends, a top-up settles,
 * an operator pauses the campaign, or another tick claims the same leads. Every
 * one of those is a real event on a busy platform, and the cost of getting it
 * wrong is calls a tenant did not authorise.
 *
 * ── WHY THE COUNT COMES FROM `campaign_leads` ─────────────────────────
 *
 * Not from `calls`: those rows are written lazily by the webhook, so a call
 * placed two seconds ago is not there yet, and pacing off them over-dials by
 * exactly the ramp — worst at the moment a campaign starts.
 *
 * Not from `dial_attempts` either, which was the first design and was wrong.
 * The ledger row is written a moment after the claim, so a second claim landing
 * in that gap saw nothing in flight and took a whole batch again. Measured
 * against the live database: with max_concurrent 3, two back-to-back claims
 * returned three rows each.
 *
 * The lead row is what this statement transitions, so counting from it makes the
 * count and the claim the same statement. The same two claims now return three
 * and then none.
 *
 * ── WHY THE LOCK IS TRANSACTION-SCOPED ────────────────────────────────
 *
 * DATABASE_URL points at Supabase's pooler in transaction mode (port 6543,
 * verified). A session-scoped advisory lock would outlive the statement and
 * leak onto whoever inherits that pooled connection next. `pg_advisory_xact_lock`
 * is released when this single statement's implicit transaction commits.
 *
 * One lock, at the tenant tier, not two. Tenant strictly contains campaign, so a
 * single acquisition makes both caps exact — and two locks in two orders is a
 * deadlock waiting for a busy afternoon.
 */

import { prisma } from "@/lib/prisma"

/** Live states, in the order the claim's predicates use them. */
const LIVE_LEAD_STATES = ["DIALING", "IN_PROGRESS"] as const

export type ClaimedLead = {
  leadId: string
  phoneE164: string
  attemptNo: number
  contactName: string | null
  crmContactId: string | null
  fields: Record<string, unknown>
}

type ClaimRow = {
  id: string
  phone_e164: string
  attempt_no: number
  contact_name: string | null
  crm_contact_id: string | null
  fields: Record<string, unknown> | null
}

export async function claimDueLeads(p: {
  tenantId: string
  campaignId: string
  /** Cap across every campaign this tenant is running. */
  tenantMaxConcurrent: number
  /** Cap across the whole platform. */
  platformMaxConcurrent: number
  /** Most this one call will take, whatever the headroom says. */
  batchCeiling: number
  /** How long a claimed lead is ours before the reaper may look at it. */
  connectLeaseSeconds: number
}): Promise<ClaimedLead[]> {
  const rows = await prisma.$queryRaw<ClaimRow[]>`
    WITH
    lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(
               hashtextextended('astrix.dialer.tenant:' || ${p.tenantId}::text, 0)) AS held
    ),
    campaign AS MATERIALIZED (
      SELECT c.id, c.max_concurrent
        FROM campaigns c
        JOIN tenants   t ON t.id = c.tenant_id
        LEFT JOIN packages p ON p.id = t.package_id
        CROSS JOIN platform_settings s
        CROSS JOIN lock
       WHERE c.id        = ${p.campaignId}::uuid
         AND c.tenant_id = ${p.tenantId}::uuid
         AND c.state     = 'RUNNING'
         AND t.status    = 'ACTIVE'
         AND s.dialer_enabled
         AND (c.throttled_until IS NULL OR c.throttled_until <= now())
         -- readAllowance(...).canCall, in SQL. See lib/billing/can-call.ts: it
         -- is "allowance left OR credit left", never "balance above zero".
         AND ( t.minutes_used < COALESCE(p.minutes_included, 0)
               OR t.credit_balance_cents > 0 )
         -- The calling window, in the campaign's own timezone. Here rather than
         -- in TypeScript so no code path can dial around it.
         AND to_char(now() AT TIME ZONE c.timezone, 'HH24:MI') >= c.window_start
         AND to_char(now() AT TIME ZONE c.timezone, 'HH24:MI') <  c.window_end
         AND EXTRACT(isodow FROM now() AT TIME ZONE c.timezone)::int = ANY (c.window_days)
    ),
    inflight AS MATERIALIZED (
      SELECT
        COALESCE(count(*) FILTER (
          WHERE l.campaign_id = (SELECT id FROM campaign)), 0)::int AS campaign_n,
        count(*)::int AS tenant_n
        FROM campaign_leads l
       WHERE l.tenant_id = ${p.tenantId}::uuid
         AND l.state IN ('DIALING','IN_PROGRESS')
         -- An expired lease stops holding a slot even before the reaper gets to
         -- it. The alternative is a permanently leaked slot if the reaper wedges,
         -- which is a silent stall — worse than a bounded overshoot.
         AND l.lease_expires_at > now()
    ),
    platform AS MATERIALIZED (
      SELECT count(*)::int AS n
        FROM campaign_leads
       WHERE state IN ('DIALING','IN_PROGRESS')
         AND lease_expires_at > now()
    ),
    headroom AS MATERIALIZED (
      SELECT GREATEST(0, LEAST(
        (SELECT max_concurrent FROM campaign) - (SELECT campaign_n FROM inflight),
        ${p.tenantMaxConcurrent}::int         - (SELECT tenant_n   FROM inflight),
        ${p.platformMaxConcurrent}::int       - (SELECT n          FROM platform),
        ${p.batchCeiling}::int
      )) AS n
    ),
    -- SKIP LOCKED is only legal on SELECT, so the lock lives here and the UPDATE
    -- joins to it. The state predicate must be INSIDE this select: under READ
    -- COMMITTED, Postgres re-evaluates a locking select's own qualifiers against
    -- the new row version after a competing transaction commits, and that is
    -- what makes a row another tick already took disappear from our result.
    -- Repeating it on the UPDATE below is insurance, not the mechanism.
    --
    -- The headroom arrives as LIMIT (SELECT …) rather than a join, because
    -- FOR UPDATE cannot be applied to a CTE reference. LIMIT 0 is exactly the
    -- "no headroom" behaviour we want.
    claimed AS MATERIALIZED (
      SELECT l.id
        FROM campaign_leads l
       WHERE l.campaign_id     = (SELECT id FROM campaign)
         AND l.state           IN ('PENDING','RETRY_WAIT')
         AND l.next_attempt_at <= now()
       ORDER BY l.next_attempt_at, l.priority DESC, l.id
       FOR UPDATE SKIP LOCKED
       LIMIT (SELECT n FROM headroom)
    )
    UPDATE campaign_leads l
       SET state            = 'DIALING',
           attempt_no       = l.attempt_no + 1,
           lease_expires_at = now() + (${p.connectLeaseSeconds}::int * interval '1 second')
      FROM claimed c
     WHERE l.id    = c.id
       AND l.state IN ('PENDING','RETRY_WAIT')
    RETURNING l.id, l.phone_e164, l.attempt_no, l.contact_name, l.crm_contact_id, l.fields
  `

  return rows.map(r => ({
    leadId:       r.id,
    phoneE164:    r.phone_e164,
    attemptNo:    r.attempt_no,
    contactName:  r.contact_name,
    crmContactId: r.crm_contact_id,
    fields:       r.fields ?? {},
  }))
}

/**
 * Hand leads back, untouched.
 *
 * Used when a tick claimed more than it managed to dial — the deadline came, the
 * campaign was paused, the tenant ran out mid-batch. The attempt is given back
 * too, because none was made.
 */
export async function releaseClaimed(leadIds: string[]): Promise<number> {
  if (!leadIds.length) return 0
  const res = await prisma.campaignLead.updateMany({
    where: { id: { in: leadIds }, state: "DIALING" },
    data:  { state: "PENDING", attemptNo: { decrement: 1 }, leaseExpiresAt: null },
  })
  return res.count
}

/**
 * Is there genuinely nothing left?
 *
 * Asked separately, and never inferred from "the claim returned nothing".
 * `LIMIT n` with `SKIP LOCKED` returns fewer rows than asked for whenever
 * another tick holds them, so treating an empty claim as an empty queue would
 * mark live campaigns COMPLETED under exactly the load that makes them matter.
 */
export async function campaignIsDrained(campaignId: string): Promise<boolean> {
  const remaining = await prisma.campaignLead.count({
    where: {
      campaignId,
      state: { in: ["PENDING", "RETRY_WAIT", "DEFERRED", "DIALING", "IN_PROGRESS"] },
    },
  })
  return remaining === 0
}

/**
 * Pick up to `limit` running campaigns to work on, oldest-served first.
 *
 * `last_ticked_at` is stamped as they are taken, which does two things: no
 * campaign starves behind a busier one, and two overlapping heartbeat ticks pick
 * disjoint sets rather than fighting over the same campaigns.
 */
export async function takeCampaignsForTick(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE campaigns c
       SET last_ticked_at = now()
      FROM (
        SELECT id FROM campaigns
         WHERE state = 'RUNNING'
         ORDER BY last_ticked_at NULLS FIRST
         FOR UPDATE SKIP LOCKED
         LIMIT ${limit}::int
      ) d
     WHERE c.id = d.id
    RETURNING c.id
  `
  return rows.map(r => r.id)
}

/**
 * Move deferred leads back into the queue once their window has reopened.
 *
 * One statement for the whole platform. A lead is DEFERRED rather than skipped
 * precisely so this can happen — nobody is dropped for being scheduled at an
 * inconvenient hour.
 */
export async function releaseDeferred(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    WITH woken AS (
      UPDATE campaign_leads l
         SET state = 'PENDING'
        FROM campaigns c
       WHERE c.id = l.campaign_id
         AND l.state = 'DEFERRED'
         AND l.next_attempt_at <= now()
         AND to_char(now() AT TIME ZONE c.timezone, 'HH24:MI') >= c.window_start
         AND to_char(now() AT TIME ZONE c.timezone, 'HH24:MI') <  c.window_end
         AND EXTRACT(isodow FROM now() AT TIME ZONE c.timezone)::int = ANY (c.window_days)
      RETURNING l.id
    )
    SELECT count(*)::bigint AS n FROM woken
  `
  return Number(rows[0]?.n ?? 0)
}

export { LIVE_LEAD_STATES }
