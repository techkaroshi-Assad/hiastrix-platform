/**
 * Shown while settings load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, PanelSkeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Settings"
      description="Your profile, your password and who else has access."
    >
      <Skeleton>
        <div className="grid gap-5 lg:grid-cols-2">
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
        </div>
        <div className="mt-5">
          <TableSkeleton rows={4} cols={4} />
        </div>
      </Skeleton>
    </Page>
  )
}
