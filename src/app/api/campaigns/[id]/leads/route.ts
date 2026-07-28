/**
 * POST /api/campaigns/[id]/leads — add people to a campaign.
 *
 * Two shapes, one route:
 *
 *   { rows: [...] }   a chunk of an uploaded file, already parsed in the browser
 *   { crmTag: "..." } everyone in the tenant's CRM carrying that tag
 *
 * The file is parsed client-side and arrives as JSON in chunks. That keeps every
 * request in this codebase JSON rather than introducing the first multipart
 * route, it means a 40,000-row file is read on the machine that already has it,
 * and it lets the person confirm which column is the phone number before a
 * single row crosses the network.
 *
 * The chunking is what makes a large file safe: each chunk reports on itself, so
 * a network hiccup two-thirds of the way through loses one chunk rather than the
 * upload, and re-sending it adds nobody twice.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { importLeads, importFromCrmTag } from "@/lib/dialer/import"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

/** One chunk. Large enough to be worth a round trip, small enough to retry. */
const MAX_ROWS = 1000

const RowSchema = z.object({
  phone:  z.string().max(40),
  name:   z.string().max(200).optional(),
  email:  z.string().max(200).optional(),
  fields: z.record(z.string(), z.string().max(500)).optional(),
})

const BodySchema = z.union([
  z.object({
    rows:   z.array(RowSchema).min(1).max(MAX_ROWS),
    /** Row number the first entry came from, so errors name the right line. */
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    crmTag: z.string().trim().min(1).max(120),
    max:    z.number().int().min(1).max(10_000).default(5000),
  }),
])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)
    if (ctx.tenant.status !== "ACTIVE") return apiError(ERRORS.ACCOUNT_PENDING, 403)

    const campaign = await prisma.campaign.findFirst({
      where:  { id, tenantId: ctx.tenant.id },
      select: { id: true, state: true },
    })
    if (!campaign) return apiError(ERRORS.NOT_FOUND, 404)

    /*
     * Adding to a running campaign is allowed on purpose — a tenant who
     * remembers another twenty people should not have to stop and start again.
     * Archived is refused, because those leads were deliberately cancelled.
     */
    if (campaign.state === "ARCHIVED") {
      return apiError("This campaign has been archived. Create a new one for these people.")
    }

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? ERRORS.FALLBACK)
    }

    /* ── From the CRM ────────────────────────────────────────────────── */

    if ("crmTag" in parsed.data) {
      if (!ctx.tenant.crmLocationId) {
        return apiError("Your CRM isn't connected yet, so there are no lists to pull from.")
      }

      const report = await importFromCrmTag({
        campaignId: id,
        tenantId: ctx.tenant.id,
        locationId: ctx.tenant.crmLocationId,
        tag: parsed.data.crmTag,
        defaultCountryCode: ctx.tenant.defaultCountryCode,
        max: parsed.data.max,
      })

      await prisma.campaign.update({
        where: { id },
        data:  { source: "CRM_TAG", sourceRef: parsed.data.crmTag },
      })

      return Response.json(report)
    }

    /* ── From a file ─────────────────────────────────────────────────── */

    const report = await importLeads({
      campaignId: id,
      tenantId: ctx.tenant.id,
      rows: parsed.data.rows,
      defaultCountryCode: ctx.tenant.defaultCountryCode,
      offset: parsed.data.offset,
    })

    return Response.json(report)
  } catch (error) {
    return apiError(sanitiseError(error, "campaigns/leads/import"))
  }
}

/**
 * DELETE /api/campaigns/[id]/leads — empty a campaign that has not started.
 *
 * Only from DRAFT. Once a campaign has run, its leads are the record of who was
 * called and what happened, and deleting that is not a thing a dialer should
 * offer — archive the campaign instead.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)

    const campaign = await prisma.campaign.findFirst({
      where:  { id, tenantId: ctx.tenant.id },
      select: { id: true, state: true },
    })
    if (!campaign) return apiError(ERRORS.NOT_FOUND, 404)

    if (campaign.state !== "DRAFT") {
      return apiError("This campaign has already run, so its list is part of your call history.")
    }

    const { count } = await prisma.campaignLead.deleteMany({ where: { campaignId: id } })
    return Response.json({ removed: count })
  } catch (error) {
    return apiError(sanitiseError(error, "campaigns/leads/clear"))
  }
}
