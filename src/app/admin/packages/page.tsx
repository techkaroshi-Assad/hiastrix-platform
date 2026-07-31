import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { adminNav } from "@/lib/nav-admin"
import { AppShell, EmptyState } from "@/components/app/app-shell"
import { IconPackages } from "@/components/app/icons"
import { PackagesClient, type PackageRow } from "./packages-client"

export const metadata: Metadata = { title: "Packages" }
export const dynamic = "force-dynamic"

export default async function AdminPackagesPage() {
  const admin = await requireAdmin()

  const packages = await prisma.package.findMany({
    orderBy: { minutesIncluded: "asc" },
    include: { _count: { select: { tenants: true } } },
  })

  const rows: PackageRow[] = packages.map(p => ({
    id:               p.id,
    name:             p.name,
    minutesIncluded:  p.minutesIncluded,
    priceCents:       p.priceCents,
    stripePriceId:    p.stripePriceId,
    overageRateCents: p.overageRateCents,
    isActive:         p.isActive,
    tenants:          p._count.tenants,
  }))

  return (
    <AppShell
      nav={adminNav("packages")}
      heading="Packages"
      description="The tiers tenants can be placed on."
      userEmail={admin.email}
    >
      {rows.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            icon={<IconPackages />}
            title="No packages yet"
            body="A package sets how many minutes a tenant gets and what each extra minute costs. Create your first tier to start assigning tenants."
          />
          <PackagesClient packages={rows} />
        </div>
      ) : (
        <PackagesClient packages={rows} />
      )}
    </AppShell>
  )
}
