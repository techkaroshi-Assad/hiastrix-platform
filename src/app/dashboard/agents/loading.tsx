/**
 * Shown while your agents load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, CardGridSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Agents"
      description="The voice agents in your workspace."
    >
      <Skeleton>
        <CardGridSkeleton />
      </Skeleton>
    </Page>
  )
}
