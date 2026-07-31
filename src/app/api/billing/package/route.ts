/**
 * Gone — plans are monthly subscriptions now, sold by /api/billing/subscribe.
 *
 * This route used to sell a plan as a single charge. Deleting the file would
 * have been tidier and worse: a browser tab open since before the change still
 * has the old client bundle, and its buy button still posts here. A 404 reads
 * as a bug and invites a retry; a 410 with a plain sentence tells the person
 * exactly what to do, which is reload the page.
 *
 * The rows it wrote are untouched. `PaymentType.PACKAGE_PURCHASE` still exists
 * so payment history from before this change reads correctly, and a tenant who
 * bought a plan under the old flow keeps it until they subscribe.
 */

export const dynamic = "force-dynamic"

export async function POST() {
  return Response.json(
    { error: "Plans are monthly now. Refresh the page and choose your plan again." },
    { status: 410 }
  )
}
