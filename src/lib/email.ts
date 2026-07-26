/**
 * Transactional email (Resend).
 *
 * Every message is plain, branded Hi-Astrix, and free of vendor names — the
 * tenant should never learn what we run underneath. Sending is best-effort:
 * a failed email must never fail the billing write that triggered it, so every
 * function here swallows its errors after logging.
 *
 * Silently inert when RESEND_API_KEY is unset, which keeps local and preview
 * environments from mailing real customers.
 */

import { Resend } from "resend"
import { prisma } from "@/lib/prisma"

let cached: Resend | null = null

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!cached) cached = new Resend(key)
  return cached
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY)
}

const FROM = process.env.EMAIL_FROM ?? "Hi-Astrix <notifications@hiastrix.com>"
const APP  = process.env.APP_URL ?? "https://app.hiastrix.com"

/* ── Shell ─────────────────────────────────────────────────────────────── */

function wrap(heading: string, body: string, cta?: { label: string; href: string }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#07070A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07070A;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0D0D14;border:1px solid rgba(255,255,255,0.07);border-radius:16px;">
        <tr><td style="padding:32px 32px 8px;">
          <div style="font-size:17px;font-weight:600;color:#F0EEFF;letter-spacing:-0.02em;">
            Hi<span style="color:#A78BFA;">-Astrix</span>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 0;">
          <h1 style="margin:0;font-size:20px;font-weight:600;color:#F0EEFF;letter-spacing:-0.025em;">${heading}</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 0;">
          <div style="font-size:14px;line-height:1.65;color:#9B97C0;">${body}</div>
        </td></tr>
        ${
          cta
            ? `<tr><td style="padding:24px 32px 0;">
                 <a href="${cta.href}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:9px;">${cta.label}</a>
               </td></tr>`
            : ""
        }
        <tr><td style="padding:32px;">
          <div style="font-size:12px;line-height:1.6;color:#555278;border-top:1px solid rgba(255,255,255,0.06);padding-top:16px;">
            You're receiving this because you have a Hi-Astrix workspace.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

async function send(to: string | string[], subject: string, html: string) {
  const resend = client()
  if (!resend) return

  try {
    await resend.emails.send({ from: FROM, to, subject, html })
  } catch (error) {
    // Never let a mail failure break the operation that triggered it.
    console.error("[email/send]", error)
  }
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/* ── Messages ──────────────────────────────────────────────────────────── */

export async function sendLowBalance(opts: {
  to: string[]
  companyName: string
  balanceCents: number
}) {
  await send(
    opts.to,
    "Your Hi-Astrix balance is running low",
    wrap(
      "Your balance is running low",
      `<p style="margin:0 0 12px;">The balance for <strong style="color:#F0EEFF;">${opts.companyName}</strong> is down to <strong style="color:#F0EEFF;">${usd(opts.balanceCents)}</strong>.</p>
       <p style="margin:0;">Once it reaches zero your agents pause automatically and calls stop being answered. Topping up now avoids any interruption.</p>`,
      { label: "Top up balance", href: `${APP}/dashboard/billing` }
    )
  )
}

export async function sendCallsPaused(opts: { to: string[]; companyName: string }) {
  await send(
    opts.to,
    "Calls paused — your Hi-Astrix balance is empty",
    wrap(
      "Your calls are paused",
      `<p style="margin:0 0 12px;">The balance for <strong style="color:#F0EEFF;">${opts.companyName}</strong> has reached zero, so every agent has been paused and incoming calls are no longer being answered.</p>
       <p style="margin:0;">Adding credit brings them straight back online — no reconfiguration needed.</p>`,
      { label: "Restore calling", href: `${APP}/dashboard/billing` }
    )
  )
}

export async function sendTopUpConfirmed(opts: {
  to: string[]
  companyName: string
  amountCents: number
  balanceCents: number
  resumed: boolean
}) {
  await send(
    opts.to,
    "Top-up confirmed",
    wrap(
      "Top-up confirmed",
      `<p style="margin:0 0 12px;">We've added <strong style="color:#F0EEFF;">${usd(opts.amountCents)}</strong> to <strong style="color:#F0EEFF;">${opts.companyName}</strong>. Your balance is now <strong style="color:#F0EEFF;">${usd(opts.balanceCents)}</strong>.</p>
       ${opts.resumed ? `<p style="margin:0;">Your agents are back online and answering calls again.</p>` : `<p style="margin:0;">Thanks — nothing else to do.</p>`}`,
      { label: "View billing", href: `${APP}/dashboard/billing` }
    )
  )
}

export async function sendCreditGranted(opts: {
  to: string[]
  companyName: string
  amountCents: number
  label: string
  balanceCents: number
}) {
  await send(
    opts.to,
    "Credit added to your workspace",
    wrap(
      "Credit added to your workspace",
      `<p style="margin:0 0 12px;">${opts.label}.</p>
       <p style="margin:0 0 12px;">We've added <strong style="color:#F0EEFF;">${usd(opts.amountCents)}</strong> to <strong style="color:#F0EEFF;">${opts.companyName}</strong>. Your balance is now <strong style="color:#F0EEFF;">${usd(opts.balanceCents)}</strong>.</p>
       <p style="margin:0;">Nothing was charged.</p>`,
      { label: "Open dashboard", href: `${APP}/dashboard` }
    )
  )
}

export async function sendWorkspaceActivated(opts: {
  to: string[]
  companyName: string
}) {
  await send(
    opts.to,
    "Your workspace is live",
    wrap(
      "Your workspace is live",
      `<p style="margin:0 0 12px;"><strong style="color:#F0EEFF;">${opts.companyName}</strong> is now active. You can build agents, assign them a number, and start taking calls.</p>
       <p style="margin:0;">If you'd like a hand setting up your first agent, just reply to this email.</p>`,
      { label: "Create an agent", href: `${APP}/dashboard/agents` }
    )
  )
}

export async function sendAccountManagerInvite(opts: {
  to: string
  name: string
  companyName: string
  password: string
}) {
  await send(
    opts.to,
    `You've been given access to ${opts.companyName}`,
    wrap(
      "You've been given access",
      `<p style="margin:0 0 12px;">Hi ${opts.name}, you now manage agents for <strong style="color:#F0EEFF;">${opts.companyName}</strong> on Hi-Astrix.</p>
       <p style="margin:0 0 12px;">Sign in with this email and the temporary password below, then change it from Settings.</p>
       <p style="margin:0;padding:12px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;font-family:ui-monospace,monospace;color:#F0EEFF;">${opts.password}</p>`,
      { label: "Sign in", href: `${APP}/login` }
    )
  )
}

/**
 * Everyone who should hear about billing for a tenant.
 *
 * Imports prisma directly rather than taking it as a parameter — Prisma's
 * delegate methods are generic, so any hand-written structural type for them
 * fails to accept the real client.
 */
export async function billingRecipients(tenantId: string): Promise<string[]> {
  try {
    const users = await prisma.tenantUser.findMany({
      where:  { tenantId, isActive: true },
      select: { email: true },
    })
    return users.map((u: { email: string }) => u.email)
  } catch (error) {
    console.error("[email/recipients]", error)
    return []
  }
}
