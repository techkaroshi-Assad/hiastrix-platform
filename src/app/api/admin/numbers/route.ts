/**
 * POST /api/admin/numbers — pull the number inventory from Vapi.
 *
 * Astrix owns a single upstream account; this mirrors that inventory locally
 * so numbers can be allocated to tenants. Existing rows keep their allocation
 * — a sync must never silently unassign a tenant's live number.
 */

import { prisma } from "@/lib/prisma"
import { getAdminContext } from "@/lib/admin"
import { vapiPhoneNumbers } from "@/lib/vapi/client"
import { ERRORS, sanitiseError, apiError } from "@/lib/errors"

type VapiNumber = { id?: string; number?: string; status?: string }

export async function POST() {
  try {
    const admin = await getAdminContext()
    if (!admin) return apiError(ERRORS.UNAUTHORIZED, 401)

    let remote: VapiNumber[]
    try {
      remote = (await vapiPhoneNumbers.list()) as VapiNumber[]
    } catch (err) {
      return apiError(sanitiseError(err, "admin/numbers/sync/provider"))
    }

    if (!Array.isArray(remote)) return apiError(ERRORS.FALLBACK)

    let added = 0
    for (const n of remote) {
      if (!n.id || !n.number) continue

      const existing = await prisma.phoneNumber.findUnique({
        where:  { vapiPhoneNumberId: n.id },
        select: { id: true },
      })

      if (existing) {
        // Refresh the display number only; allocation is ours to own.
        await prisma.phoneNumber.update({
          where: { id: existing.id },
          data:  { phoneNumber: n.number },
        })
      } else {
        await prisma.phoneNumber.create({
          data: {
            vapiPhoneNumberId: n.id,
            phoneNumber:       n.number,
            status:            "ACTIVE",
          },
        })
        added++
      }
    }

    return Response.json({ ok: true, total: remote.length, added })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/numbers/sync"))
  }
}
