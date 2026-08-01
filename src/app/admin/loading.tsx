/**
 * Shown while the console loads.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, StatRowSkeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Admin"
    >
      <Skeleton>
        <StatRowSkeleton />
        <div className="mt-6">
          <TableSkeleton rows={10} cols={6} />
        </div>
      </Skeleton>
    </Page>
  )
}
