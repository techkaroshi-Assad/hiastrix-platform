import type { Metadata } from "next"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { hashToken } from "@/lib/invitations"
import { AuthShell, AuthLink } from "@/components/auth/auth-shell"
import { AcceptForm } from "./accept-form"

export const metadata: Metadata = { title: "Join a workspace" }
export const dynamic = "force-dynamic"

/**
 * Public. The proxy guards only /admin and /dashboard, so this is reachable
 * while signed out — which is the entire point of an invitation link.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const invite = await prisma.tenantInvitation.findUnique({
    where:   { tokenHash: hashToken(token) },
    include: { tenant: { select: { companyName: true, status: true } } },
  })

  const dead = (title: string, message: string) => (
    <AuthShell title={title} subtitle={message} footer={<AuthLink href="/login">Back to sign in</AuthLink>}>
      <p className="text-center text-[13px] text-subtle">
        If you think this is a mistake, ask whoever invited you to send a fresh link.
      </p>
    </AuthShell>
  )

  if (!invite) {
    return dead("Invitation not found", "This link doesn't match any invitation.")
  }
  if (invite.status === "REVOKED") {
    return dead("Invitation withdrawn", "This invitation was cancelled.")
  }
  if (invite.status === "ACCEPTED") {
    return (
      <AuthShell
        title="Already accepted"
        subtitle="This invitation has been used."
        footer={
          <>
            Ready to go?{" "}
            <Link href="/login" className="text-muted underline-offset-4 hover:text-fg hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <p className="text-center text-[13px] text-subtle">
          Your account already exists — sign in with the email this link was sent to.
        </p>
      </AuthShell>
    )
  }
  if (invite.status === "EXPIRED" || invite.expiresAt < new Date()) {
    return dead("Invitation expired", "Invitations are valid for seven days.")
  }
  if (invite.tenant.status === "BLOCKED" || invite.tenant.status === "INACTIVE") {
    return dead("Workspace unavailable", "This workspace isn't accepting new members right now.")
  }

  return (
    <AuthShell
      title={`Join ${invite.tenant.companyName}`}
      subtitle="Set a password and you're in."
      footer={<AuthLink href="/login">Already have an account? Sign in</AuthLink>}
    >
      <AcceptForm token={token} email={invite.email} initialName={invite.name} />
    </AuthShell>
  )
}
