/**
 * Shown while billing loads.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, StatRowSkeleton, PanelSkeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Billing"
      description="Your plan, your balance and what you have spent."
    >
      <Skeleton>
        <StatRowSkeleton />
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <PanelSkeleton lines={4} />
          <PanelSkeleton lines={4} />
        </div>
        <div className="mt-5">
          <TableSkeleton rows={6} cols={5} />
        </div>
      </Skeleton>
    </Page>
  )
}
