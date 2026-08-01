/**
 * Shown while your numbers load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Phone numbers"
      description="The numbers allocated to your workspace, and the agent answering each."
    >
      <Skeleton>
        <TableSkeleton rows={5} cols={5} />
      </Skeleton>
    </Page>
  )
}
