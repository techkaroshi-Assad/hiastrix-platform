/**
 * Shown while settings load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, PanelSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Settings"
    >
      <Skeleton>
        <div className="grid gap-5 lg:grid-cols-2">
          <PanelSkeleton lines={4} />
          <PanelSkeleton lines={4} />
        </div>
      </Skeleton>
    </Page>
  )
}
