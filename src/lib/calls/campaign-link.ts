/**
 * Which campaign a call came from — SERVER ONLY.
 *
 * ── WHY THIS IS NOT A COLUMN ──────────────────────────────────────────
 *
 * `calls` has no `campaign_id`. The relationship is recorded the other way
 * round: the dialer writes a `dial_attempts` row before it places the call,
 * and once the provider answers with an id it stores that as
 * `provider_call_id`. The webhook, which knows nothing about campaigns,
 * later creates the `calls` row under the same id as `vapi_call_id`.
 *
 * So the join is `dial_attempts.provider_call_id = calls.vapi_call_id`, with
 * no foreign key between them — the two rows are written by different
 * processes seconds apart and either can arrive first. lib/campaigns/insights.ts
 * has always joined this way; this module exists so the call *pages* can do
 * the same thing without each one rediscovering it.
 *
 * An inbound call, a test call, or a call placed outside a campaign simply
 * has no attempt row, and resolves to null. That is not an error.
 */

import { prisma } from "@/lib/prisma"

export type CallCampaign = {
  campaignId: string
  campaignName: string
  /** The lead as the uploaded list named them, when there is one. */
  leadName: string | null
  /** Which attempt this was — "3rd try" is context a reader wants. */
  attemptNo: number
}

/**
 * Resolve campaigns for many calls at once.
 *
 * Keyed by `vapiCallId`, not by our own call id, because that is the column
 * the join actually uses. Callers map back themselves.
 *
 * One query for a whole page of calls: the list view renders 50 rows and a
 * per-row lookup would be 50 round trips for a single column.
 */
export async function campaignsForCalls(
  tenantId: string,
  vapiCallIds: string[]
): Promise<Map<string, CallCampaign>> {
  const ids = vapiCallIds.filter(Boolean)
  if (ids.length === 0) return new Map()

  const attempts = await prisma.dialAttempt.findMany({
    where: { tenantId, providerCallId: { in: ids } },
    select: {
      providerCallId: true,
      campaignId: true,
      attemptNo: true,
      campaign: { select: { name: true } },
      lead: { select: { contactName: true } },
    },
  })

  const out = new Map<string, CallCampaign>()
  for (const a of attempts) {
    if (!a.providerCallId) continue
    out.set(a.providerCallId, {
      campaignId: a.campaignId,
      campaignName: a.campaign.name,
      leadName: a.lead?.contactName ?? null,
      attemptNo: a.attemptNo,
    })
  }
  return out
}

/** The single-call case, for the detail page. */
export async function campaignForCall(
  tenantId: string,
  vapiCallId: string | null
): Promise<CallCampaign | null> {
  if (!vapiCallId) return null
  const found = await campaignsForCalls(tenantId, [vapiCallId])
  return found.get(vapiCallId) ?? null
}
