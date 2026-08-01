/**
 * Shown while your campaigns load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, CardGridSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Campaigns"
      description="Outbound calling, worked through a list."
    >
      <Skeleton>
        <CardGridSkeleton n={3} />
      </Skeleton>
    </Page>
  )
}
