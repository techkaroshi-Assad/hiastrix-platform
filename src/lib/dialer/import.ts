/**
 * Getting leads into a campaign — SERVER ONLY.
 *
 * Every rule that keeps the dialer from ringing the wrong person is applied
 * here, at import, rather than at dial time. That is a deliberate choice: a row
 * rejected now is something the tenant can see and fix while they are looking at
 * their own spreadsheet. A row rejected at dial time is a lead that silently
 * fails at three in the afternoon two days later, and nobody finds out.
 *
 * The dial path checks suppression again anyway — a number can be added to the
 * do-not-call list after an import — but by then it is a backstop rather than
 * the place the tenant learns anything.
 */

import { prisma } from "@/lib/prisma"
import { toE164 } from "@/lib/dialer/phone"
import type { ImportRow } from "@/lib/dialer/csv"

export type ImportReport = {
  received: number
  added: number
  /** Already in this campaign. Re-uploading the same file is not an error. */
  duplicate: number
  /** Same number twice inside the one upload. */
  duplicateInFile: number
  suppressed: number
  invalid: { row: number; value: string; reason: string }[]
}

/** One insert per chunk rather than per row, and small enough to stay quick. */
const CHUNK = 500

export async function importLeads(a: {
  campaignId: string
  tenantId: string
  rows: ImportRow[]
  defaultCountryCode: string
  /** Row number the first entry corresponds to, for a readable error list. */
  offset?: number
}): Promise<ImportReport> {
  const report: ImportReport = {
    received: a.rows.length, added: 0, duplicate: 0,
    duplicateInFile: 0, suppressed: 0, invalid: [],
  }

  const offset = a.offset ?? 0
  const seen = new Map<string, ImportRow>()

  a.rows.forEach((row, i) => {
    const result = toE164(row.phone ?? "", a.defaultCountryCode)
    if (!result.ok) {
      report.invalid.push({ row: offset + i + 1, value: row.phone ?? "", reason: result.reason })
      return
    }
    // Normalising first is what makes this work: "+1 (313) 555-0100" and
    // "3135550100" are the same person and must not become two queue rows that
    // both ring.
    if (seen.has(result.e164)) { report.duplicateInFile++; return }
    seen.set(result.e164, row)
  })

  if (!seen.size) return report

  const numbers = [...seen.keys()]

  const [suppressed, existing] = await Promise.all([
    prisma.suppression.findMany({
      where:  { tenantId: a.tenantId, phoneE164: { in: numbers } },
      select: { phoneE164: true },
    }),
    prisma.campaignLead.findMany({
      where:  { campaignId: a.campaignId, phoneE164: { in: numbers } },
      select: { phoneE164: true },
    }),
  ])

  const blocked = new Set(suppressed.map(s => s.phoneE164))
  const already = new Set(existing.map(e => e.phoneE164))

  const toInsert: {
    campaignId: string; tenantId: string; phoneE164: string
    contactName: string | null; fields: Record<string, string>
  }[] = []

  for (const [phone, row] of seen) {
    if (blocked.has(phone)) { report.suppressed++; continue }
    if (already.has(phone)) { report.duplicate++; continue }

    toInsert.push({
      campaignId: a.campaignId,
      tenantId:   a.tenantId,
      phoneE164:  phone,
      contactName: row.name?.trim() || null,
      fields: {
        ...(row.fields ?? {}),
        ...(row.email ? { email: row.email } : {}),
      },
    })
  }

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const batch = toInsert.slice(i, i + CHUNK)
    const res = await prisma.campaignLead.createMany({
      data: batch,
      // The unique index on (campaignId, phoneE164) is the real guard. Two
      // uploads of the same file racing each other both read `already` as empty
      // and both try to insert; without this the second one throws and loses
      // every row in its chunk, including the ones that were fine.
      skipDuplicates: true,
    })
    report.added += res.count
    report.duplicate += batch.length - res.count
  }

  return report
}

/**
 * Pull a list out of the tenant's own CRM.
 *
 * Everyone carrying a chosen tag, snapshotted into the campaign at creation.
 * Snapshotted, not linked: tagging someone new tomorrow does not quietly add
 * them to a campaign that is already running, and removing a tag does not pull
 * somebody out mid-call. Re-running the list is a new campaign, which is also
 * how the tenant gets a record of who was called when.
 */
export async function importFromCrmTag(a: {
  campaignId: string
  tenantId: string
  locationId: string
  tag: string
  defaultCountryCode: string
  /** Guard against a tag that matches half the database. */
  max?: number
}): Promise<ImportReport & { fetched: number; withoutPhone: number }> {
  const { crmContacts } = await import("@/lib/crm/client")

  const max = a.max ?? 5000
  const contacts = await crmContacts.byTag(a.locationId, a.tag, max)

  let withoutPhone = 0
  const rows: ImportRow[] = []

  for (const c of contacts) {
    if (!c.phone) { withoutPhone++; continue }
    rows.push({
      phone: c.phone,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || undefined,
      email: c.email || undefined,
      fields: { crmContactId: c.id },
    })
  }

  const report = await importLeads({
    campaignId: a.campaignId,
    tenantId: a.tenantId,
    rows,
    defaultCountryCode: a.defaultCountryCode,
  })

  // The CRM contact id is what lets the outcome be written back to the right
  // person afterwards, so it is carried on the lead rather than left in `fields`.
  await linkCrmContacts(a.campaignId)

  return { ...report, fetched: contacts.length, withoutPhone }
}

/** Lift `fields.crmContactId` onto the column the write-back reads. */
async function linkCrmContacts(campaignId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE campaign_leads
       SET crm_contact_id = fields ->> 'crmContactId'
     WHERE campaign_id = ${campaignId}::uuid
       AND crm_contact_id IS NULL
       AND fields ? 'crmContactId'
  `
}
