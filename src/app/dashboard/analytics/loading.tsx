/**
 * Shown while the numbers load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, StatRowSkeleton, ChartSkeleton, PanelSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Analytics"
      description="How your agents are performing."
    >
      <Skeleton>
        <StatRowSkeleton />
        <div className="mt-6">
          <ChartSkeleton />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <PanelSkeleton lines={6} />
          <PanelSkeleton lines={6} />
        </div>
      </Skeleton>
    </Page>
  )
}
