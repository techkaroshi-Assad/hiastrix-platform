/**
 * Shown while the overview loads.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, StatRowSkeleton, PanelSkeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Overview"
    >
      <Skeleton>
        <StatRowSkeleton />
        <PanelSkeleton className="mt-6" lines={2} />
        <div className="mt-6">
          <TableSkeleton rows={6} cols={5} />
        </div>
      </Skeleton>
    </Page>
  )
}
