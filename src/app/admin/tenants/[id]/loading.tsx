/**
 * Shown while the tenant loads.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, StatRowSkeleton, PanelSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Tenant"
    >
      <Skeleton>
        <StatRowSkeleton />
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <PanelSkeleton lines={5} />
          <PanelSkeleton lines={5} />
        </div>
      </Skeleton>
    </Page>
  )
}
