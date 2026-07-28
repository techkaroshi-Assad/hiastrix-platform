/**
 * POST /api/campaigns — create a campaign, in DRAFT.
 *
 * Always DRAFT. A campaign is created, then filled with people, then started —
 * three deliberate steps, because the alternative is a form submission that
 * immediately begins ringing strangers.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTenantContext } from "@/lib/tenant"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const BodySchema = z.object({
  name:     z.string().trim().min(2, "Give the campaign a name.").max(120),
  agentId:  z.string().uuid(),
  /** Null rotates across every number the agent has. */
  phoneNumberId: z.string().uuid().nullable().default(null),
  source:   z.enum(["CSV", "CRM_TAG", "MANUAL"]).default("CSV"),
  sourceRef: z.string().max(200).nullable().default(null),

  maxConcurrent: z.number().int().min(1).max(100).default(3),
  maxAttempts:   z.number().int().min(1).max(10).default(3),

  timezone:    z.string().min(1).max(64).default("America/New_York"),
  windowStart: z.string().regex(HHMM, "Use a time like 09:00.").default("09:00"),
  windowEnd:   z.string().regex(HHMM, "Use a time like 19:00.").default("19:00"),
  windowDays:  z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one day.")
                .default([1, 2, 3, 4, 5]),

  voicemailPolicy:  z.enum(["LEAVE_MESSAGE", "HANG_UP_RETRY", "HANG_UP_DONE"])
                     .default("HANG_UP_RETRY"),
  voicemailMessage: z.string().max(1000).nullable().default(null),
})
.refine(b => b.windowStart < b.windowEnd, {
  message: "The calling window has to end after it starts.",
  path: ["windowEnd"],
})

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    if (!ctx) return apiError(ERRORS.UNAUTHORIZED, 401)
    if (ctx.tenant.status !== "ACTIVE") return apiError(ERRORS.ACCOUNT_PENDING, 403)

    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? ERRORS.FALLBACK)
    }
    const b = parsed.data

    // Scoped to the tenant, so an agent belonging to somebody else reads as
    // missing rather than forbidden.
    const agent = await prisma.agent.findFirst({
      where:  { id: b.agentId, tenantId: ctx.tenant.id },
      select: { id: true },
    })
    if (!agent) return apiError(ERRORS.NOT_FOUND, 404)

    if (b.phoneNumberId) {
      const number = await prisma.phoneNumber.findFirst({
        where:  { id: b.phoneNumberId, tenantId: ctx.tenant.id, agentId: agent.id },
        select: { id: true },
      })
      if (!number) {
        return apiError("That number isn't attached to this agent.")
      }
    }

    // Intl.supportedValuesOf would be neater but is not available everywhere;
    // formatting a date in the zone throws if the zone is not real, which is
    // the same check without the feature detection.
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: b.timezone }).format(new Date())
    } catch {
      return apiError("That time zone isn't one we recognise.")
    }

    const campaign = await prisma.campaign.create({
      data: {
        tenantId: ctx.tenant.id,
        agentId: b.agentId,
        phoneNumberId: b.phoneNumberId,
        name: b.name,
        state: "DRAFT",
        source: b.source,
        sourceRef: b.sourceRef,
        maxConcurrent: b.maxConcurrent,
        maxAttempts: b.maxAttempts,
        timezone: b.timezone,
        windowStart: b.windowStart,
        windowEnd: b.windowEnd,
        windowDays: b.windowDays,
        voicemailPolicy: b.voicemailPolicy,
        voicemailMessage: b.voicemailMessage,
        createdBy: ctx.email,
      },
      select: { id: true },
    })

    return Response.json({ id: campaign.id })
  } catch (error) {
    return apiError(sanitiseError(error, "campaigns/create"))
  }
}
