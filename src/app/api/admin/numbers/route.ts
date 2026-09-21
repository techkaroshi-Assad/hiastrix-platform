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

type VapiNumber = { id?: string; number?: string; status?: string; provider?: string }

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
        // Refresh the display number and provider only; allocation is ours
        // to own. Provider is refreshed too — a number's origin doesn't
        // change, but an early row synced before this column existed should
        // pick it up on the next sync rather than stay null forever.
        await prisma.phoneNumber.update({
          where: { id: existing.id },
          /*
           * Seeing the number in the provider's inventory IS the proof that
           * it works again, so the sync is the right place to clear the
           * "can't place calls" flag. Without this, a re-imported number
           * would stay out of rotation for ever and the only cure would be
           * a hand-written UPDATE — which is exactly the kind of silent
           * dead end this flag was added to stop.
           */
          data:  {
            phoneNumber:     n.number,
            provider:        n.provider ?? null,
            providerError:   null,
            providerErrorAt: null,
          },
        })
      } else {
        await prisma.phoneNumber.create({
          data: {
            vapiPhoneNumberId: n.id,
            phoneNumber:       n.number,
            status:            "ACTIVE",
            provider:          n.provider ?? null,
          },
        })
        added++
      }
    }

    /*
     * ── The check that would have caught this in seconds ────────────────
     *
     * Everything above only looks at numbers the provider DID return. The
     * expensive failure is the opposite: a number we still hold that the
     * provider has forgotten. Its id stops resolving, every dial is refused
     * before it rings, and nothing anywhere says so — a live campaign spent
     * two hours placing 174 rejected calls on one while the tenant's healthy
     * second number was never tried.
     *
     * A sync already has the full upstream inventory in hand, so answering
     * "which of ours is missing from it?" is one comparison and turns a
     * silent two-hour outage into a red banner before anyone allocates the
     * number. Numbers that are re-imported come back with a new provider id,
     * so the old row is flagged here and the new one is created above —
     * which is the correct outcome for both.
     */
    const liveIds = remote.map(n => n.id).filter(Boolean) as string[]
    const stale = await prisma.phoneNumber.updateMany({
      where: {
        vapiPhoneNumberId: { notIn: liveIds },
        providerError: null,
      },
      data: {
        providerError:   "This number is no longer in the provider's inventory, so calls can't be placed on it.",
        providerErrorAt: new Date(),
      },
    })

    return Response.json({ ok: true, total: remote.length, added, flagged: stale.count })
  } catch (error) {
    return apiError(sanitiseError(error, "admin/numbers/sync"))
  }
}
