"use client"

/**
 * Auth layouts — canvas-backed.
 *
 * AuthShell — centred glass card over a live Neural Mesh canvas.
 *             Used on: sign-in, forgot-password, update-password.
 *
 * AuthSplit — Magnetic Field left panel + Neural Mesh right (mobile only).
 *             Used on: sign-up.
 *
 * Vendor-free: no Supabase, no Prisma names appear here.
 */

import Link from "next/link"
import { Logo } from "@/components/brand/logo"
import { NeuralMeshCanvas, MagneticFieldCanvas } from "@/components/ui/auth-canvas"
import { ThemeToggle } from "@/components/theme/theme-toggle"

/* ── Centred card ─────────────────────────────────────────── */

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink px-5 py-12">

      {/* Live canvas backdrop */}
      <NeuralMeshCanvas />

      {/* Radial vignette — keeps the card readable over the canvas */}
      <div aria-hidden="true" className="wash-centre pointer-events-none absolute inset-0" />

      {/* Offered before sign-in on purpose — someone on a bright screen shouldn't
          have to authenticate through a dark page first. */}
      <div className="absolute right-5 top-5 z-20">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-[400px] animate-rise-in">
        <div className="glass rounded-card px-8 py-9">
          <div className="mb-7 flex justify-center">
            <Logo size={30} />
          </div>

          <h1 className="text-center text-[21px] font-semibold tracking-[-0.025em]">
            {title}
          </h1>

          {subtitle && (
            <p className="mt-1.5 text-center text-[13px] font-light text-muted">
              {subtitle}
            </p>
          )}

          <div className="mt-7">{children}</div>
        </div>

        {footer && (
          <div className="mt-5 text-center text-[13px] text-subtle">{footer}</div>
        )}

        <p className="mt-8 text-center text-[11px] text-subtle opacity-70">
          © {new Date().getFullYear()} Hi-Astrix. All rights reserved.
        </p>
      </div>
    </main>
  )
}

/* ── Split layout ─────────────────────────────────────────── */

const STATS = [
  { value: "99.9%",  label: "uptime" },
  { value: "<400ms", label: "response" },
  { value: "40+",    label: "languages" },
]

export function AuthSplit({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-ink lg:flex-row">

      {/* ── Left — brand panel ──────────────────────────────── */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line p-12 lg:flex lg:w-[52%] lg:min-h-screen lg:shrink-0">

        {/* Magnetic field canvas */}
        <MagneticFieldCanvas />

        {/* Darken overlay so text stays legible */}
        <div aria-hidden="true" className="wash-panel pointer-events-none absolute inset-0" />

        {/* Logo */}
        <Link href="/" className="relative z-10 w-fit">
          <Logo size={28} />
        </Link>

        {/* Headline */}
        <div className="relative z-10">
          <p className="max-w-[390px] text-[28px] font-light leading-[1.32] tracking-[-0.022em]">
            Voice agents that{" "}
            <span className="text-gradient-brand font-semibold">sound human</span>,
            deployed under your own brand.
          </p>
          <p className="mt-5 max-w-[360px] text-[13.5px] font-light leading-relaxed text-muted">
            Launch, monitor and bill AI calling agents from one workspace — with
            your logo on every screen your customers ever see.
          </p>
        </div>

        {/* Stats */}
        <div className="relative z-10 flex gap-8">
          {STATS.map(s => (
            <div key={s.label}>
              <div className="text-[22px] font-semibold tracking-[-0.022em]">{s.value}</div>
              <div className="mt-0.5 text-[11px] uppercase tracking-widest text-subtle">{s.label}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Right — form ────────────────────────────────────── */}
      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-12">

        {/* Mobile canvas (hidden on lg+) */}
        <div className="pointer-events-none absolute inset-0 lg:hidden">
          <NeuralMeshCanvas />
        </div>

        {/* Subtle violet bloom on the form side (desktop) */}
        <div aria-hidden="true" className="wash-glow pointer-events-none absolute inset-0 hidden lg:block" />

        <div className="absolute right-5 top-5 z-20">
          <ThemeToggle />
        </div>

        <div className="relative w-full max-w-[340px] animate-rise-in">

          {/* Logo — mobile only */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo size={30} />
          </div>

          <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{title}</h1>

          {subtitle && (
            <p className="mt-1.5 text-[13px] font-light text-muted">{subtitle}</p>
          )}

          <div className="mt-7">{children}</div>

          {footer && (
            <div className="mt-6 text-center text-[13px] text-subtle">{footer}</div>
          )}
        </div>
      </section>
    </main>
  )
}

/* ── Shared link ──────────────────────────────────────────── */

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-muted underline-offset-4 transition-colors duration-200 hover:text-fg hover:underline"
    >
      {children}
    </Link>
  )
}
