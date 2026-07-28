/**
 * PATCH /api/campaigns/[id] — change settings, or start / pause / resume / archive.
 *
 * One route for both because they are the same decision from the tenant's side:
 * this is the campaign, and this is what I want it to do now. Keeping them apart
 * would mean two places that have to agree about when a campaign may run.
 *
 * Starting is the only action with real consequences, and it is the only one
 * that runs `campaignReadiness`. Everything a campaign needs in order not to
 * embarrass its owner — credit, an agent that is on, a number to call from,
 * somebody left to call, voicemail detection when the policy depends on it — is
 * checked there, with a message naming the thing to go and fix.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { campaignReadiness } from "@/lib/dialer/readiness"
import { releaseClaimed } from "@/lib/dialer/claim"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const BodySchema = z.object({
  action: z.enum(["start", "pause", "archive"]).optional(),

  name:          z.string().trim().min(2).max(120).optional(),
  phoneNumberId: z.string().uuid().nullable().optional(),
  maxConcurrent: z.number().int().min(1).max(100).optional(),
  maxAttempts:   z.number().int().min(1).max(10).optional(),
  timezone:      z.string().min(1).max(64).optional(),
  windowStart:   z.string().regex(HHMM).optional(),
  windowEnd:     z.string().regex(HHMM).optional(),
  windowDays:    z.array(z.number().int().min(1).max(7)).min(1).optional(),
  voicemailPolicy:  z.enum(["LEAVE_MESSAGE", "HANG_UP_RETRY", "HANG_UP_DONE"]).optional(),
  voicemailMessage: z.string().max(1000).nullable().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    const campaign = await prisma.campaign.findFirst({
      where:  { id, tenantId: ctx.tenant.id },
      select: { id: true, state: true, agentId: true },
    })
    if (!campaign) return apiError(ERRORS.NOT_FOUND, 404)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? ERRORS.FALLBACK)
    const { action, ...settings } = parsed.data

    /* ── Settings ────────────────────────────────────────────────────── */

    if (Object.keys(settings).length) {
      if (campaign.state === "ARCHIVED") {
        return apiError("This campaign has been archived and can't be changed.")
      }

      if (settings.phoneNumberId) {
        const number = await prisma.phoneNumber.findFirst({
          where:  { id: settings.phoneNumberId, tenantId: ctx.tenant.id, agentId: campaign.agentId },
          select: { id: true },
        })
        if (!number) return apiError("That number isn't attached to this agent.")
      }

      if (settings.timezone) {
        try {
          new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone }).format(new Date())
        } catch {
          return apiError("That time zone isn't one we recognise.")
        }
      }

      await prisma.campaign.update({ where: { id }, data: settings })
    }

    /* ── Actions ─────────────────────────────────────────────────────── */

    if (action === "start") {
      const ready = await campaignReadiness(id)
      if (!ready.ok) return apiError(ready.reason)

      await prisma.campaign.updateMany({
        where: { id, state: { in: ["DRAFT", "PAUSED", "COMPLETED"] } },
        data: {
          state: "RUNNING",
          pausedReason: null,
          // Cleared so the campaign is not stuck behind a throttle it earned an
          // hour ago and has already waited out.
          throttledUntil: null,
          startedAt: new Date(),
          completedAt: null,
        },
      })
    }

    if (action === "pause") {
      await prisma.campaign.updateMany({
        where: { id, state: "RUNNING" },
        data:  { state: "PAUSED", pausedReason: "Paused by you." },
      })

      /*
       * Calls already up are left to finish. That is correct — hanging up on
       * somebody mid-sentence because a button was pressed would be worse than
       * letting the call end — but it is surprising, so the UI says so.
       *
       * What is released is anything claimed and not yet dialled: those leads go
       * straight back to the queue with their attempt handed back, rather than
       * sitting in DIALING until their lease expires.
       */
      const claimedNotDialled = await prisma.campaignLead.findMany({
        where: {
          campaignId: id,
          state: "DIALING",
          attempts: { none: { state: { in: ["DIALING", "IN_PROGRESS"] } } },
        },
        select: { id: true },
      })
      if (claimedNotDialled.length) {
        await releaseClaimed(claimedNotDialled.map(l => l.id))
      }
    }

    if (action === "archive") {
      await prisma.$transaction([
        prisma.campaign.update({
          where: { id },
          data:  { state: "ARCHIVED", pausedReason: null },
        }),
        // Everything still waiting is cancelled outright, so an archived
        // campaign can never be resumed into calling a list its owner has
        // moved on from.
        prisma.campaignLead.updateMany({
          where: { campaignId: id, state: { in: ["PENDING", "RETRY_WAIT", "DEFERRED"] } },
          data:  { state: "CANCELLED", leaseExpiresAt: null, note: "Campaign archived." },
        }),
      ])
    }

    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "campaigns/update"))
  }
}
