/**
 * Shown while your calls load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Calls"
      description="Every call placed or answered in your workspace."
    >
      <Skeleton>
        <div className="mb-5 flex flex-wrap gap-2">
          <div className="h-9 w-40 rounded-field bg-field-hover" />
          <div className="h-9 w-32 rounded-field bg-field-hover" />
          <div className="h-9 w-32 rounded-field bg-field-hover" />
        </div>
        <TableSkeleton rows={12} cols={8} />
      </Skeleton>
    </Page>
  )
}
