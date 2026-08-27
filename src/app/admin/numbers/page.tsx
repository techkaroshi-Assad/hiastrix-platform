import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { Page } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { SyncButton, AllocateSelect } from "./numbers-admin-client"

export const metadata: Metadata = { title: "Phone numbers" }
export const dynamic = "force-dynamic"

/**
 * Vapi's own `provider` field on each number, turned into what an operator
 * actually needs to know before allocating it: is this safe to put behind an
 * outbound campaign, or is it the free shared-pool type that hits a hard
 * daily outbound-call limit? That distinction is invisible in Vapi's own
 * dashboard unless you know to look for it — found the hard way, after a
 * live campaign hit `call.start.error-vapi-number-outbound-daily-limit`
 * partway through its list.
 */
const PROVIDER_LABEL: Record<string, { label: string; tone: "warning" | "success" | "neutral"; note: string }> = {
  vapi: {
    label: "Vapi-managed (free)",
    tone: "warning",
    note: "Shared pool, hard daily outbound limit. Fine for testing — do not put a real campaign behind this.",
  },
  twilio:  { label: "Twilio",  tone: "success", note: "Purchased number. No Vapi-side daily outbound cap." },
  telnyx:  { label: "Telnyx",  tone: "success", note: "Purchased number. No Vapi-side daily outbound cap." },
  vonage:  { label: "Vonage",  tone: "success", note: "Purchased number. No Vapi-side daily outbound cap." },
  "byo-phone-number": {
    label: "Bring your own",
    tone: "success",
    note: "Imported via your own SIP trunk. No Vapi-side daily outbound cap.",
  },
}

function providerInfo(provider: string | null) {
  if (provider && PROVIDER_LABEL[provider]) return PROVIDER_LABEL[provider]
  return { label: provider ?? "Unknown", tone: "neutral" as const, note: "Re-sync to pick up its type." }
}

export default async function AdminNumbersPage() {
  const admin = await requireAdmin()

  const [numbers, tenants] = await Promise.all([
    prisma.phoneNumber.findMany({
      orderBy: { phoneNumber: "asc" },
      include: {
        tenant: { select: { id: true, companyName: true } },
        agent:  { select: { name: true } },
      },
    }),
    prisma.tenant.findMany({
      orderBy: { companyName: "asc" },
      select:  { id: true, companyName: true },
    }),
  ])

  const unallocated = numbers.filter(n => !n.tenantId).length
  const freeCount = numbers.filter(n => n.provider === "vapi").length

  return (
    <Page
      heading="Phone numbers"
      description="The upstream inventory and who each number belongs to."
      actions={<SyncButton />}
    >
      {freeCount > 0 && (
        <div className="mb-5 rounded-2xl border border-warning/30 bg-warning/[0.06] px-5 py-4">
          <p className="text-[13px] font-medium text-warning">
            {freeCount} free Vapi-managed number{freeCount === 1 ? "" : "s"} in this inventory
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            These come from Vapi&rsquo;s shared free pool and carry a hard daily
            limit on outbound calls — fine for testing an agent, not for a real
            outbound campaign at volume. Allocate a purchased number (Twilio,
            Telnyx, Vonage, or your own SIP trunk) to any tenant running
            campaigns instead. Import it in the Vapi dashboard first, then
            &ldquo;Sync inventory&rdquo; here to bring it in — it&rsquo;ll show
            up tagged below automatically.
          </p>
        </div>
      )}

      <Card
        title={`${numbers.length} number${numbers.length === 1 ? "" : "s"}`}
        action={
          <span className="text-[12.5px] text-subtle">
            {unallocated} unallocated
          </span>
        }
      >
        <Table>
          <thead>
            <tr>
              <TH>Number</TH>
              <TH>Type</TH>
              <TH>Status</TH>
              <TH>Answering agent</TH>
              <TH align="right">Allocated to</TH>
            </tr>
          </thead>
          <tbody>
            {numbers.length === 0 ? (
              <EmptyRow colSpan={5}>
                No numbers yet. Use “Sync inventory” to pull them in.
              </EmptyRow>
            ) : (
              numbers.map(n => {
                const info = providerInfo(n.provider)
                return (
                  <tr key={n.id} className="transition-colors hover:bg-field-soft">
                    <TD className="font-medium tabular-nums">{n.phoneNumber}</TD>
                    <TD>
                      <Pill tone={info.tone}>{info.label}</Pill>
                    </TD>
                    <TD>
                      <Pill tone={n.status === "ACTIVE" ? "success" : "neutral"}>
                        {n.status === "ACTIVE" ? "Active" : "Inactive"}
                      </Pill>
                    </TD>
                    <TD muted>{n.agent?.name ?? "—"}</TD>
                    <TD align="right">
                      <div className="flex justify-end">
                        <AllocateSelect
                          numberId={n.id}
                          tenantId={n.tenant?.id ?? null}
                          tenants={tenants}
                        />
                      </div>
                    </TD>
                  </tr>
                )
              })
            )}
          </tbody>
        </Table>
      </Card>
    </Page>
  )
}
