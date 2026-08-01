/**
 * Shown while calls load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="All calls"
    >
      <Skeleton>
        <TableSkeleton rows={14} cols={8} />
      </Skeleton>
    </Page>
  )
}
