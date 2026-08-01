/**
 * Shown while the builder loads.
 *
 * The shape matches the real page, so nothing moves when the data lands.
 */

import { Page } from "@/components/app/app-shell"
import { Skeleton, FormSkeleton } from "@/components/app/skeleton"

export default function Loading() {
  return (
    <Page
      heading="New agent"
    >
      <Skeleton>
        <FormSkeleton fields={5} />
      </Skeleton>
    </Page>
  )
}
