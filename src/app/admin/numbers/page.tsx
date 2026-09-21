import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/admin"
import { Page } from "@/components/app/app-shell"
import { Card, Table, TH, TD, Pill, EmptyRow } from "@/components/app/table"
import { dateTime } from "@/lib/format"
import { SyncButton, AllocateSelect, DailyCapInput } from "./numbers-admin-client"

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

  const [numbers, tenants, settings] = await Promise.all([
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
    prisma.platformSettings.findFirst({ where: { id: true }, select: { numberDailyCallCap: true } }),
  ])

  const platformCap = settings?.numberDailyCallCap ?? 200

  /*
   * Calls placed from each number in the last 24 hours, counted the same way
   * the dialer counts them (attempts the provider refused before dialling
   * never reached a carrier, so they do not spend the cap). Shown next to
   * the limit so the figure being edited has context.
   */
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const usedRows = numbers.length
    ? await prisma.dialAttempt.groupBy({
        by: ["phoneNumberId"],
        where: {
          phoneNumberId: { in: numbers.map(n => n.id) },
          createdAt: { gte: since },
          NOT: [
            { endedReason: "astrix-rejected" },
            { endedReason: { startsWith: "call.start.error" } },
          ],
        },
        _count: { _all: true },
      })
    : []
  const usedBy = new Map(
    usedRows
      .filter(u => u.phoneNumberId)
      .map(u => [u.phoneNumberId as string, u._count._all])
  )

  const unallocated = numbers.filter(n => !n.tenantId).length
  const freeCount = numbers.filter(n => n.provider === "vapi").length

  /*
   * Numbers the provider has stopped recognising.
   *
   * This is the loudest thing on the page, above the free-number notice,
   * because it is the failure that costs the most and shows the least. A
   * Twilio number was re-imported on the provider side, the id stored here
   * stopped resolving, and every dial was refused instantly — 174 in two
   * hours, on a live campaign, with nothing anywhere saying so. The tenant's
   * other number was never tried, because refused attempts don't count
   * toward a daily cap, so the dead number stayed "least used" and won
   * rotation every time.
   */
  const broken = numbers.filter(n => n.providerError)

  return (
    <Page
      heading="Phone numbers"
      description="The upstream inventory and who each number belongs to."
      actions={<SyncButton />}
    >
      {broken.length > 0 && (
        <div className="mb-5 rounded-2xl border border-danger/40 bg-danger/[0.08] px-5 py-4">
          <p className="text-[13px] font-medium text-danger">
            {broken.length} number{broken.length === 1 ? "" : "s"} can&rsquo;t place calls
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            The upstream provider no longer recognises {broken.length === 1 ? "this number" : "these numbers"},
            so every call on {broken.length === 1 ? "it" : "them"} is refused before it rings.
            {broken.length === 1 ? " It has" : " They have"} been taken out of dialling
            automatically — campaigns carry on using the tenant&rsquo;s other numbers.
            Re-import in the provider dashboard, then press <strong>Sync inventory</strong> to
            clear this.
          </p>
          <ul className="mt-3 space-y-1.5">
            {broken.map(n => (
              <li key={n.id} className="text-[12.5px] text-muted">
                <span className="font-medium tabular-nums">{n.phoneNumber}</span>
                {n.providerErrorAt && (
                  <span className="text-subtle"> · stopped working {dateTime(n.providerErrorAt)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
              <TH align="right">Calls today</TH>
              <TH align="right">Calls per day</TH>
              <TH align="right">Allocated to</TH>
            </tr>
          </thead>
          <tbody>
            {numbers.length === 0 ? (
              <EmptyRow colSpan={7}>
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
                      {/* A number the provider has stopped recognising is
                          not "Active" in any sense a reader cares about — it
                          reads as healthy while refusing every call. */}
                      <Pill tone={n.providerError ? "danger" : n.status === "ACTIVE" ? "success" : "neutral"}>
                        {n.providerError ? "Not at provider" : n.status === "ACTIVE" ? "Active" : "Inactive"}
                      </Pill>
                    </TD>
                    <TD muted>{n.agent?.name ?? "—"}</TD>
                    <TD align="right" muted className="tabular-nums">
                      {(usedBy.get(n.id) ?? 0).toLocaleString()} / {(n.dailyCallCap ?? platformCap).toLocaleString()}
                    </TD>
                    <TD align="right">
                      <div className="flex justify-end">
                        <DailyCapInput
                          numberId={n.id}
                          value={n.dailyCallCap}
                          platformDefault={platformCap}
                        />
                      </div>
                    </TD>
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
        <p className="border-t border-line px-5 py-4 text-[12.5px] leading-relaxed text-subtle">
          <strong className="font-medium text-muted">Calls per day</strong> is this
          number&rsquo;s own limit over a rolling 24 hours. Leave it blank to use the
          platform default of {platformCap.toLocaleString()}, which you can change under
          Settings &rarr; Outbound dialer. The limit is ours, not the carrier&rsquo;s: it
          exists so a single caller ID doesn&rsquo;t dial all day and get flagged as spam.
          A purchased number on a warmed-up reputation can safely run higher. Campaigns
          rotate across every number attached to their agent, so two numbers at 200 give
          the agent 400 calls a day.
        </p>
      </Card>
    </Page>
  )
}
