/**
 * Shown while numbers load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Phone numbers"
    >
      <Skeleton>
        <TableSkeleton rows={10} cols={5} />
      </Skeleton>
    </Page>
  )
}
