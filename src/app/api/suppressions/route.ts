/**
 * The do-not-call list.
 *
 * POST   /api/suppressions   add numbers (one, or a pasted block)
 * DELETE /api/suppressions   remove one
 *
 * Per tenant, and checked twice — once when a list is imported, so the tenant
 * can see who was dropped, and again immediately before every dial, because a
 * number can be added to it while a campaign is already running.
 *
 * Adding somebody also pulls them out of every campaign they are currently
 * queued in. A do-not-call list that only applies to future imports is not a
 * do-not-call list.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { toE164 } from "@/lib/dialer/phone"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const MAX = 2000

const PostSchema = z.object({
  /** One per line, or comma separated — however it arrived from a spreadsheet. */
  numbers: z.string().min(1).max(60_000),
  note:    z.string().max(200).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    const parsed = PostSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? ERRORS.FALLBACK)

    const raw = parsed.data.numbers
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, MAX)

    const good: string[] = []
    const invalid: string[] = []

    for (const r of raw) {
      const result = toE164(r, ctx.tenant.defaultCountryCode)
      if (result.ok) good.push(result.e164)
      else invalid.push(r)
    }

    const unique = [...new Set(good)]
    if (!unique.length) {
      return apiError("None of those look like phone numbers.")
    }

    const { count } = await prisma.suppression.createMany({
      data: unique.map(phoneE164 => ({
        tenantId:  ctx.tenant.id,
        phoneE164,
        source:    "UPLOAD" as const,
        note:      parsed.data.note,
        createdBy: ctx.email,
      })),
      // Adding a number that is already on the list is not an error, and must
      // not lose the rest of the batch.
      skipDuplicates: true,
    })

    /*
     * Pull them out of anything still queued.
     *
     * Scoped to states that have not been called yet — a lead already COMPLETED
     * is history and stays as it is. A lead currently DIALING is left alone too:
     * the call is up, and rewriting the row underneath it would only confuse the
     * outcome when it lands.
     */
    const { count: pulled } = await prisma.campaignLead.updateMany({
      where: {
        tenantId:  ctx.tenant.id,
        phoneE164: { in: unique },
        state:     { in: ["PENDING", "RETRY_WAIT", "DEFERRED"] },
      },
      data: {
        state: "SUPPRESSED",
        leaseExpiresAt: null,
        note: "Added to your do-not-call list.",
      },
    })

    return Response.json({
      added: count,
      alreadyListed: unique.length - count,
      removedFromCampaigns: pulled,
      invalid,
    })
  } catch (error) {
    return apiError(sanitiseError(error, "suppressions/add"))
  }
}

const DeleteSchema = z.object({ id: z.string().uuid() })

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    const parsed = DeleteSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(ERRORS.FALLBACK)

    // deleteMany with the tenant in the filter, so somebody else's entry is a
    // no-op rather than a 403 that confirms it exists.
    const { count } = await prisma.suppression.deleteMany({
      where: { id: parsed.data.id, tenantId: ctx.tenant.id },
    })
    if (!count) return apiError(ERRORS.NOT_FOUND, 404)

    /*
     * Deliberately does NOT put anybody back into a campaign.
     *
     * Taking a number off the list means new lists may include it. Silently
     * re-queueing somebody who was removed — possibly because they asked to be —
     * is not something a person pressing "remove" is asking for.
     */
    return Response.json({ ok: true })
  } catch (error) {
    return apiError(sanitiseError(error, "suppressions/remove"))
  }
}
