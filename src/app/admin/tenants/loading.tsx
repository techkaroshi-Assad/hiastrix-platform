/**
 * Shown while tenants load.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, TableSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="Tenants"
    >
      <Skeleton>
        <TableSkeleton rows={12} cols={6} />
      </Skeleton>
    </Page>
  )
}
