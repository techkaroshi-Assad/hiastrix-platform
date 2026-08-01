/**
 * The tenant shell, rendered once.
 *
 * Before this file existed, every page under /dashboard rendered its own copy
 * of the sidebar. Two things followed from that, and both were bad.
 *
 * The sidebar re-mounted on every navigation — logo, nine links, theme toggle,
 * sign-out button — none of which had changed. And because there was no layout
 * boundary, Next had nowhere to hang a loading state, so clicking "Calls" left
 * you looking at the page you were leaving until the database answered. No
 * spinner, no skeleton, nothing moving. The app was not necessarily slow; it
 * simply had no way of saying it was working.
 *
 * With the shell here, the rail is instant and `loading.tsx` files can exist.
 *
 * ── WHY THE GUIDANCE LIVES HERE TOO ───────────────────────────────────
 *
 * The setup bar and the blocker bars are rendered by the layout rather than by
 * each page, for the same reason the sidebar is: they have to be true
 * everywhere. Guidance that only appears on Overview is guidance somebody
 * misses, because the moment they are lost is the moment they have wandered off
 * to Settings looking for the thing they cannot find.
 *
 * It costs one extra query per navigation, and that is the whole price. The
 * counts in `loadOnboarding` are all indexed and none of them touch a large
 * table without a tenant scope.
 *
 * `requireTenant` is called here *and* in each page, deliberately.
 * `getTenantContext` is wrapped in React's `cache`, so the second call inside
 * one request is free — and having the guard in both places means a page can
 * never accidentally render for a signed-out visitor because somebody forgot
 * it, which is the failure mode a layout-only guard invites.
 */

import { requireTenant } from "@/lib/tenant"
import { tenantNav } from "@/lib/nav"
import { Shell } from "@/components/app/shell"
import { loadOnboarding } from "@/lib/onboarding"
import { SetupBar, SetupDoneBar, BlockerBar } from "@/components/app/setup-bar"

export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { tenant, email } = await requireTenant()
  const onboarding = await loadOnboarding(tenant)

  return (
    <Shell nav={tenantNav()} userEmail={email}>
      {/* Order is the priority order, and it is not arbitrary. Something
          actively stopping calls outranks a setup step every time — a tenant
          whose phone has gone quiet does not need to be told about step three.
          At most one bar of each kind, so the top of the page never becomes a
          stack of advice. */}
      {onboarding.blockers.length > 0 && (
        <BlockerBar {...onboarding.blockers[0]!} />
      )}

      {onboarding.blockers.length === 0 && onboarding.next && (
        <SetupBar
          stepKey={onboarding.next.key}
          title={onboarding.next.title}
          body={onboarding.next.body}
          href={onboarding.next.href}
          cta={onboarding.next.cta}
          waiting={onboarding.next.waiting}
          done={onboarding.done}
          total={onboarding.total}
        />
      )}

      {onboarding.blockers.length === 0 && onboarding.complete && <SetupDoneBar />}

      {children}
    </Shell>
  )
}
